/**
 * PrusaLink (MK4/MK3.9/MINI/XL/CORE One…): API REST local v1.
 * Autenticación con clave API (`X-Api-Key`) o usuario y contraseña (HTTP Digest).
 */
import type { PrinterState } from "../../../lib/domain";
import type { PrinterTelemetry } from "../../../lib/telemetry";
import type { AdapterFactory } from "../types";
import { num, obj, str, titleFromFile } from "./_shared";
import { HttpError, baseUrl, getJson } from "./_http";

const STATES: Record<string, PrinterState> = {
  IDLE: "idle",
  READY: "idle",
  BUSY: "preparing",
  PRINTING: "printing",
  PAUSED: "paused",
  FINISHED: "finished",
  STOPPED: "idle",
  ERROR: "error",
  ATTENTION: "paused",
};

/** Traduce `/api/v1/status` + `/api/v1/job` (null si no hay trabajo) al modelo común. */
export function mapPrusaLink(statusRes: unknown, jobRes: unknown, base?: string, firmware?: string): PrinterTelemetry {
  const printer = obj(obj(statusRes).printer);
  const statusJob = obj(obj(statusRes).job);
  const job = obj(jobRes);
  const native = (str(printer.state, 20) ?? "").toUpperCase();
  const hasJob = Object.keys(job).length > 0 || num(statusJob.id) !== undefined;
  let state: PrinterState = STATES[native] ?? "offline";
  // «BUSY» sin trabajo es la máquina haciendo algo por su cuenta (calentar, mover…).
  if (native === "BUSY" && !hasJob) state = "idle";

  const out: PrinterTelemetry = { state };
  if (native === "BUSY") out.stateDetail = hasJob ? "Preparando" : "Ocupada";
  if (native === "STOPPED") out.stateDetail = "Cancelada";
  if (native === "ATTENTION") {
    out.stateDetail = "Requiere tu atención";
    out.errors = [{ message: "La impresora espera tu intervención (cambio de filamento, retirada de la pieza u otro aviso en pantalla)." }];
  }
  if (native === "ERROR") out.errors = [{ message: "La impresora informa de un error. Revisa su pantalla." }];

  if (hasJob && state !== "idle" && state !== "offline") {
    const file = obj(job.file);
    const fileName = str(file.name) ?? str(file.display_name);
    const thumb = str(obj(file.refs).thumbnail, 300);
    out.job = {
      ...(fileName ? { fileName } : {}),
      ...(str(file.display_name) ? { title: titleFromFile(str(file.display_name)) } : fileName ? { title: titleFromFile(fileName) } : {}),
      ...((num(job.progress) ?? num(statusJob.progress)) !== undefined ? { progress: num(job.progress) ?? num(statusJob.progress) } : {}),
      ...((num(job.time_printing) ?? num(statusJob.time_printing)) !== undefined ? { elapsedSec: num(job.time_printing) ?? num(statusJob.time_printing) } : {}),
      ...((num(job.time_remaining) ?? num(statusJob.time_remaining)) !== undefined ? { remainingSec: num(job.time_remaining) ?? num(statusJob.time_remaining) } : {}),
      // La miniatura exige autenticación: solo se enlaza si es una URL absoluta.
      ...(thumb && /^https?:\/\//i.test(thumb) ? { thumbnailUrl: thumb } : {}),
    };
  }
  void base;

  const temps: NonNullable<PrinterTelemetry["temps"]> = {};
  if (num(printer.temp_nozzle) !== undefined) temps.nozzle = { current: num(printer.temp_nozzle)!, target: num(printer.target_nozzle) ?? 0 };
  if (num(printer.temp_bed) !== undefined) temps.bed = { current: num(printer.temp_bed)!, target: num(printer.target_bed) ?? 0 };
  if (Object.keys(temps).length > 0) out.temps = temps;
  if (num(printer.speed) !== undefined) out.speedPct = num(printer.speed);
  if (firmware) out.firmware = firmware;
  return out;
}

export const createAdapter: AdapterFactory = (ctx) => {
  const base = baseUrl(str(ctx.config.host, 300));
  const auth = { apiKey: str(ctx.config.apiKey), username: str(ctx.config.username) ?? "maker", password: str(ctx.config.password) };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let firmware: string | undefined;
  let failures = 0;

  const offline = (message?: string) => ctx.onTelemetry({ state: "offline", ...(message ? { errors: [{ message }] } : {}) });

  const poll = async () => {
    if (stopped || !base) return;
    try {
      if (!firmware) {
        firmware = await getJson(base, "/api/version", auth).then((v) => (str(obj(v).firmware) ? `Firmware ${str(obj(v).firmware)}` : str(obj(v).server) ? `PrusaLink ${str(obj(v).server)}` : undefined)).catch(() => undefined);
      }
      const status = await getJson(base, "/api/v1/status", auth);
      const hasJob = num(obj(obj(status).job).id) !== undefined;
      const job = hasJob ? await getJson(base, "/api/v1/job", auth).catch(() => null) : null;
      failures = 0;
      ctx.onTelemetry(mapPrusaLink(status, job, base, firmware));
    } catch (error) {
      failures += 1;
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) offline("PrusaLink ha rechazado las credenciales (clave API o usuario y contraseña).");
      else offline();
      if (failures === 1) ctx.log("warn", `No se pudo consultar PrusaLink: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!stopped) timer = setTimeout(poll, failures > 0 ? Math.min(30_000, 3000 * failures) : 3000);
  };

  return {
    start() {
      if (!base) return offline("Falta la dirección IP de la impresora.");
      if (!auth.apiKey && !auth.password) return offline("Falta la clave API de PrusaLink (o el usuario y la contraseña).");
      offline();
      void poll();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
};
