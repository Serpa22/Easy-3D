/**
 * OctoPrint: API REST con clave (`X-Api-Key`). Se consulta `/api/job` y
 * `/api/printer` cada pocos segundos.
 */
import type { PrinterState } from "../../../lib/domain";
import type { PrinterTelemetry } from "../../../lib/telemetry";
import type { AdapterFactory } from "../types";
import { num, obj, str, titleFromFile } from "./_shared";
import { HttpError, baseUrl, getJson } from "./_http";

/** Traduce `/api/job` + `/api/printer` al modelo común. `printer` es null si OctoPrint responde 409 (impresora no operativa). */
export function mapOctoPrint(jobRes: unknown, printerRes: unknown, firmware?: string): PrinterTelemetry {
  const j = obj(jobRes);
  const text = str(j.state, 120) ?? "";
  const flags = obj(obj(obj(printerRes).state).flags);
  const progress = obj(j.progress);
  const completion = num(progress.completion);
  const printTime = num(progress.printTime);

  let state: PrinterState;
  let stateDetail: string | undefined;
  if (flags.error === true || /^error/i.test(text) || /offline after error/i.test(text)) state = "error";
  else if (/^offline/i.test(text) || flags.closedOrError === true || (!printerRes && !/print|paus|cancel/i.test(text))) {
    state = "offline";
    stateDetail = /serial|detecting|opening|connecting/i.test(text) ? "Conectando con la impresora" : "La impresora no está conectada a OctoPrint";
  } else if (flags.paused === true || flags.pausing === true || /^paus/i.test(text)) state = "paused";
  else if (/^starting/i.test(text)) {
    state = "preparing";
    stateDetail = "Iniciando";
  } else if (flags.printing === true || flags.cancelling === true || flags.finishing === true || flags.resuming === true || /^(printing|cancelling|finishing|resuming)/i.test(text)) {
    state = "printing";
    if (flags.cancelling === true || /^cancelling/i.test(text)) stateDetail = "Cancelando";
  } else if (completion !== undefined && completion >= 100) state = "finished";
  else state = "idle";

  const out: PrinterTelemetry = { state, ...(stateDetail ? { stateDetail } : {}) };
  if (state === "error") out.errors = [{ message: text || "OctoPrint informa de un error en la impresora." }];

  const file = obj(obj(j.job).file);
  const fileName = str(file.name) ?? str(file.path);
  if (fileName && state !== "idle" && state !== "offline") {
    const length = num(obj(obj(obj(j.job).filament).tool0).length);
    out.job = {
      fileName,
      title: str(file.display) ? titleFromFile(str(file.display)) : titleFromFile(fileName),
      ...(completion !== undefined ? { progress: completion } : {}),
      ...(printTime !== undefined ? { elapsedSec: printTime } : {}),
      ...(num(progress.printTimeLeft) !== undefined ? { remainingSec: num(progress.printTimeLeft) } : {}),
      // La longitud de filamento es la estimación del laminador para todo el trabajo.
      ...(length !== undefined && completion !== undefined ? { filamentUsedMm: Math.round((length * completion) / 100) } : {}),
    };
  }

  const temperature = obj(obj(printerRes).temperature);
  const temps: NonNullable<PrinterTelemetry["temps"]> = {};
  for (const [key, name] of [["tool0", "nozzle"], ["bed", "bed"], ["chamber", "chamber"]] as const) {
    const t = obj(temperature[key]);
    if (num(t.actual) !== undefined) temps[name] = { current: num(t.actual)!, ...(num(t.target) !== undefined ? { target: num(t.target)! } : {}) };
  }
  if (Object.keys(temps).length > 0) out.temps = temps;
  if (firmware) out.firmware = firmware;
  return out;
}

export const createAdapter: AdapterFactory = (ctx) => {
  const base = baseUrl(str(ctx.config.baseUrl, 300));
  const auth = { apiKey: str(ctx.config.apiKey) };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let firmware: string | undefined;
  let failures = 0;

  const offline = (message?: string) => ctx.onTelemetry({ state: "offline", ...(message ? { errors: [{ message }] } : {}) });

  const poll = async () => {
    if (stopped || !base) return;
    try {
      if (!firmware) {
        firmware = await getJson(base, "/api/version", auth).then((v) => (str(obj(v).server) ? `OctoPrint ${str(obj(v).server)}` : undefined)).catch(() => undefined);
      }
      const job = await getJson(base, "/api/job", auth);
      // 409 = OctoPrint funciona pero la impresora no está operativa.
      const printer = await getJson(base, "/api/printer", auth).catch((error) => {
        if (error instanceof HttpError && error.status === 409) return null;
        throw error;
      });
      failures = 0;
      ctx.onTelemetry(mapOctoPrint(job, printer, firmware));
    } catch (error) {
      failures += 1;
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) offline("OctoPrint ha rechazado la clave API.");
      else offline();
      if (failures === 1) ctx.log("warn", `No se pudo consultar OctoPrint: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!stopped) timer = setTimeout(poll, failures > 0 ? Math.min(30_000, 3000 * failures) : 3000);
  };

  return {
    start() {
      if (!base || !auth.apiKey) return offline("Faltan la dirección de OctoPrint o la clave API.");
      offline();
      void poll();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
};
