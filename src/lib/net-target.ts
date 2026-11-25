/**
 * Validación de la dirección de una impresora (IP o nombre de la red local).
 *
 * Pura y sin dependencias: la usan el formulario y las acciones al guardar, y
 * los adaptadores al conectar (también dentro del bridge). Evita que un texto
 * mal escrito («192.168.1.60:7125:7125», «mi impresora») llegue a `fetch` o a
 * un WebSocket, y que la dirección apunte a servicios internos del servidor.
 */

export interface NetTarget {
  /** Nombre o IP normalizados (IPv6 entre corchetes). */
  host: string;
  port?: number;
  /** true si se escribió con https:// o wss:// */
  secure: boolean;
  /** Ruta sin barra final («» si no hay). */
  path: string;
}

export interface TargetOptions {
  /** Admite «http://», «https://», «ws://» o «wss://» delante. */
  scheme?: boolean;
  /** Admite «:puerto». */
  port?: boolean;
  /** Admite una ruta detrás (OctoPrint en «/octoprint»). */
  path?: boolean;
}

const SCHEME = /^(https?|wss?):\/\//i;

/** Analiza una dirección escrita por el usuario. Devuelve null si no es válida. */
export function parseTarget(value: unknown, opts: TargetOptions = {}): NetTarget | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  // Sin espacios, caracteres de control, barras invertidas ni credenciales incrustadas.
  if (!text || text.length > 255 || /[\s\\@\u0000-\u001f\u007f]/.test(text)) return null;

  const scheme = SCHEME.exec(text)?.[1].toLowerCase();
  if (scheme && !opts.scheme) return null;
  const rest = scheme ? text.replace(SCHEME, "") : text;
  if (!rest || rest.includes("://")) return null;

  let url: URL;
  try {
    url = new URL(`http://${rest}`);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash || rest.includes("?") || rest.includes("#")) return null;
  const host = url.hostname.toLowerCase();
  if (!host || !/^(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)$/.test(host)) return null;

  const path = url.pathname.replace(/\/+$/, "");
  if (path && !opts.path) return null;

  // `new URL` omite el puerto 80: se recupera del texto para no perder un «:80» explícito.
  const explicitPort = /:(\d{1,5})(?:\/|$)/.exec(rest.replace(/^\[[^\]]*\]/, ""))?.[1];
  let port: number | undefined;
  if (explicitPort !== undefined) {
    if (!opts.port) return null;
    port = Number(explicitPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  }
  return { host, ...(port !== undefined ? { port } : {}), secure: scheme === "https" || scheme === "wss", path };
}

/**
 * Direcciones que nunca son una impresora y sí un riesgo si el servidor las
 * consulta: enlace local (donde viven los metadatos de los proveedores de
 * nube) y la dirección «cualquiera».
 */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "0.0.0.0" || h === "::" || h === "metadata" || h === "metadata.google.internal" || h.endsWith(".internal")) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true; // fe80::/10
  if (h === "fd00:ec2::254") return true;
  // IPv4 incrustada en IPv6 («::ffff:169.254.169.254» o su forma hexadecimal «::ffff:a9fe:…»).
  if (/^::ffff:(169\.254\.|a9fe:)/.test(h)) return true;
  return false;
}

/** `parseTarget` + lista de bloqueo, con el motivo en español para mostrarlo en el formulario. */
export function checkTarget(value: unknown, opts: TargetOptions = {}): { target: NetTarget } | { error: string } {
  const target = parseTarget(value, opts);
  if (!target) {
    return {
      error: opts.path
        ? "Dirección no válida. Ejemplo: http://192.168.1.70"
        : opts.port
          ? "Dirección no válida. Escribe solo la IP o el nombre (y el puerto, si hace falta). Ejemplo: 192.168.1.60"
          : "Dirección no válida. Escribe solo la IP o el nombre. Ejemplo: 192.168.1.50",
    };
  }
  if (isBlockedHost(target.host)) return { error: "Esta dirección no está permitida: usa la IP de la impresora en tu red." };
  return { target };
}

/** URL base http(s) a partir de un destino ya validado. */
export function httpBaseOf(target: NetTarget, defaultPort?: number): string {
  const port = target.port ?? defaultPort;
  return `${target.secure ? "https" : "http"}://${target.host}${port !== undefined ? `:${port}` : ""}${target.path}`;
}
