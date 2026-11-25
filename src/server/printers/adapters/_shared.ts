/** Utilidades comunes para adaptadores (Node puro, sin dependencias de Next). */
import type { PrinterState } from "../../../lib/domain";
import type { PrinterTelemetry, Temperature } from "../../../lib/telemetry";

const STATES: readonly PrinterState[] = ["offline", "idle", "preparing", "printing", "paused", "finished", "error"];

/* ---------- Lectura segura de JSON no fiable ---------- */

export function num(value: unknown): number | undefined {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}
export function str(value: unknown, max = 200): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  return s ? s.slice(0, max) : undefined;
}
export function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export const round = (n: number, decimals = 1) => Math.round(n * 10 ** decimals) / 10 ** decimals;

/** Mezcla profunda de actualizaciones parciales (Bambu, Moonraker envían solo lo que cambia). */
export function deepMerge<T extends Record<string, unknown>>(target: T, patch: Record<string, unknown>): T {
  for (const [key, value] of Object.entries(patch)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const current = (target as Record<string, unknown>)[key];
    if (value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)) {
      deepMerge(current as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      (target as Record<string, unknown>)[key] = value;
    }
  }
  return target;
}

/** Espera creciente con variación aleatoria: 1 s → 30 s. */
export function backoffMs(attempt: number, baseMs = 1000, maxMs = 30_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 10));
  return Math.round(exp * (0.7 + Math.random() * 0.6));
}

/** Nombre de archivo sin carpetas ni extensión, como título legible. */
export function titleFromFile(file: string | undefined): string | undefined {
  if (!file) return undefined;
  const base = file.split(/[\\/]/).pop() ?? file;
  return base.replace(/\.(gcode|g|gco|bgcode|3mf|ctb|goo|cbddlp)(\.3mf)?$/i, "").replace(/\.gcode$/i, "").slice(0, 200) || undefined;
}

/** Solo URLs http(s): evita esquemas peligrosos que lleguen desde un dispositivo. */
export function safeUrl(value: unknown): string | undefined {
  const s = str(value, 500);
  if (!s) return undefined;
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function temp(value: Temperature | undefined): Temperature | undefined {
  const current = num(value?.current);
  if (current === undefined) return undefined;
  const target = num(value?.target);
  return { current: round(clamp(current, -50, 1000)), ...(target !== undefined ? { target: round(clamp(target, 0, 1000)) } : {}) };
}

const pos = (v: unknown, max: number) => {
  const n = num(v);
  return n === undefined ? undefined : clamp(n, 0, max);
};

/**
 * Normaliza y acota lo que envía una impresora (o un bridge) antes de guardarlo:
 * estados válidos, porcentajes 0..100, sin NaN/Infinity y cadenas recortadas.
 */
export function sanitizeTelemetry(input: unknown): PrinterTelemetry {
  const t = obj(input);
  const state = STATES.includes(t.state as PrinterState) ? (t.state as PrinterState) : "offline";
  const out: PrinterTelemetry = { state };
  const detail = str(t.stateDetail, 120);
  if (detail) out.stateDetail = detail;

  const j = obj(t.job);
  if (Object.keys(j).length > 0) {
    const job: NonNullable<PrinterTelemetry["job"]> = {};
    const fileName = str(j.fileName);
    const title = str(j.title);
    if (fileName) job.fileName = fileName;
    if (title) job.title = title;
    const progress = pos(j.progress, 100);
    if (progress !== undefined) job.progress = round(progress);
    const layer = pos(j.layer, 1e6);
    const totalLayers = pos(j.totalLayers, 1e6);
    if (layer !== undefined) job.layer = Math.round(layer);
    if (totalLayers !== undefined) job.totalLayers = Math.round(totalLayers);
    const elapsed = pos(j.elapsedSec, 60 * 86400);
    const remaining = pos(j.remainingSec, 60 * 86400);
    if (elapsed !== undefined) job.elapsedSec = Math.round(elapsed);
    if (remaining !== undefined) job.remainingSec = Math.round(remaining);
    const mm = pos(j.filamentUsedMm, 1e8);
    const g = pos(j.filamentUsedG, 1e6);
    if (mm !== undefined) job.filamentUsedMm = Math.round(mm);
    if (g !== undefined) job.filamentUsedG = round(g);
    const thumb = safeUrl(j.thumbnailUrl);
    if (thumb) job.thumbnailUrl = thumb;
    if (Object.keys(job).length > 0) out.job = job;
  }

  const temps = obj(t.temps) as { nozzle?: Temperature; bed?: Temperature; chamber?: Temperature };
  const nozzle = temp(temps.nozzle);
  const bed = temp(temps.bed);
  const chamber = temp(temps.chamber);
  if (nozzle || bed || chamber) out.temps = { ...(nozzle ? { nozzle } : {}), ...(bed ? { bed } : {}), ...(chamber ? { chamber } : {}) };

  const speed = pos(t.speedPct, 1000);
  if (speed !== undefined) out.speedPct = Math.round(speed);
  const fan = pos(t.fanPct, 100);
  if (fan !== undefined) out.fanPct = Math.round(fan);
  const power = pos(t.powerW, 100_000);
  if (power !== undefined) out.powerW = round(power);

  const filament = arr(t.filament)
    .slice(0, 32)
    .map((f) => {
      const s = obj(f);
      const color = str(s.color, 9);
      const remainingPct = pos(s.remainingPct, 100);
      return {
        slot: str(s.slot, 40) ?? "—",
        ...(str(s.type, 40) ? { type: str(s.type, 40) } : {}),
        ...(color && /^#[0-9a-fA-F]{6}$/.test(color) ? { color: color.toLowerCase() } : {}),
        ...(str(s.name, 80) ? { name: str(s.name, 80) } : {}),
        ...(remainingPct !== undefined ? { remainingPct: Math.round(remainingPct) } : {}),
        ...(s.active === true ? { active: true } : {}),
      };
    });
  if (filament.length > 0) out.filament = filament;

  const errors = arr(t.errors)
    .slice(0, 10)
    .map((e) => {
      const s = obj(e);
      const message = str(s.message, 300);
      return message ? { message, ...(str(s.code, 40) ? { code: str(s.code, 40) } : {}) } : null;
    })
    .filter((e): e is { message: string; code?: string } => e !== null);
  if (errors.length > 0) out.errors = errors;

  const firmware = str(t.firmware, 60);
  if (firmware) out.firmware = firmware;
  const camera = safeUrl(t.cameraUrl);
  if (camera) out.cameraUrl = camera;
  return out;
}
