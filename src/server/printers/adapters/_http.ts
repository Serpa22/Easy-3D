/** Sondeo HTTP con clave API o autenticación Digest (PrusaLink), para adaptadores REST. */
import { createHash, randomBytes } from "node:crypto";
import { httpBaseOf, isBlockedHost, parseTarget } from "../../../lib/net-target";

const md5 = (text: string) => createHash("md5").update(text).digest("hex");

export interface HttpAuth {
  apiKey?: string;
  username?: string;
  password?: string;
}

/** Cabecera `Authorization: Digest …` a partir del reto del servidor (RFC 7616, MD5, qop=auth). */
export function digestHeader(challenge: string, method: string, path: string, username: string, password: string): string | null {
  const params: Record<string, string> = {};
  for (const m of challenge.replace(/^Digest\s+/i, "").matchAll(/(\w+)=("([^"]*)"|[^,\s]+)/g)) params[m[1].toLowerCase()] = m[3] ?? m[2];
  if (!params.realm || !params.nonce) return null;
  const ha1 = md5(`${username}:${params.realm}:${password}`);
  const ha2 = md5(`${method}:${path}`);
  const qop = params.qop?.split(",").map((s) => s.trim()).includes("auth") ? "auth" : undefined;
  const nc = "00000001";
  const cnonce = randomBytes(8).toString("hex");
  const response = qop ? md5(`${ha1}:${params.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${params.nonce}:${ha2}`);
  return (
    `Digest username="${username}", realm="${params.realm}", nonce="${params.nonce}", uri="${path}", response="${response}"` +
    (qop ? `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"` : "") +
    (params.opaque ? `, opaque="${params.opaque}"` : "") +
    (params.algorithm ? `, algorithm=${params.algorithm}` : "")
  );
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * GET que devuelve JSON (o null con 204). Lanza HttpError con el código si no es 2xx.
 *
 * No sigue redirecciones: una impresora no redirige, y seguirlas permitiría que
 * una dirección ajena desviara la petición (y la clave) hacia otro servicio.
 */
export async function getJson(base: string, path: string, auth: HttpAuth, timeoutMs = 8000): Promise<unknown> {
  const url = `${base}${path}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (auth.apiKey) headers["X-Api-Key"] = auth.apiKey;
  let res = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 401 && auth.username && auth.password) {
    const challenge = res.headers.get("www-authenticate") ?? "";
    const header = /^digest/i.test(challenge) ? digestHeader(challenge, "GET", path, auth.username, auth.password) : null;
    if (header) res = await fetch(url, { headers: { ...headers, Authorization: header }, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  }
  if (res.status === 204) return null;
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`);
  return res.json();
}

/**
 * Normaliza «192.168.1.70», «192.168.1.70:5000» o «http://…/octoprint/» a una URL base
 * sin barra final. Devuelve undefined si la dirección no es válida o no está permitida.
 */
export function baseUrl(value: string | undefined): string | undefined {
  const target = parseTarget(value, { scheme: true, port: true, path: true });
  if (!target || isBlockedHost(target.host)) return undefined;
  return httpBaseOf(target);
}

/** Texto corto y sin datos del servidor remoto para el registro (nunca el cuerpo de la respuesta). */
export function describeError(error: unknown): string {
  if (error instanceof HttpError) return `HTTP ${error.status}`;
  if (error instanceof SyntaxError) return "respuesta no válida";
  const e = error as { name?: string; code?: string; cause?: { code?: string } } | null;
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "sin respuesta (tiempo agotado)";
  const code = e?.cause?.code ?? e?.code;
  return typeof code === "string" && /^[A-Z_0-9]{3,40}$/.test(code) ? code : "error de red";
}
