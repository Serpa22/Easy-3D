/**
 * Fechas contables ('YYYY-MM-DD') y periodos. Isomórfico y sin dependencias.
 * «Hoy» depende de la zona horaria de la organización, no de la del servidor.
 */
import { DEFAULT_TIME_ZONE } from "./format";

/** Fecha de hoy ('YYYY-MM-DD') en la zona horaria indicada. */
export function todayISO(timeZone = DEFAULT_TIME_ZONE, now: Date = new Date()): string {
  return dateToISO(now, timeZone);
}

/** Instante → fecha local 'YYYY-MM-DD' en la zona horaria indicada. */
export function dateToISO(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function monthOf(dateISO: string): string {
  return dateISO.slice(0, 7);
}

export function isISODate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isISOMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Suma días a una fecha 'YYYY-MM-DD'. */
export function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Suma meses a 'YYYY-MM'. */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Suma meses a 'YYYY-MM-DD' conservando el día (ajustado al fin de mes). */
export function addMonthsToDate(dateISO: string, delta: number): string {
  const [y, m, day] = dateISO.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + delta, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}

/** Primer y último día (inclusive) de un mes 'YYYY-MM'. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** Lista de los últimos `count` meses terminando en `endMonth` (ascendente). */
export function lastMonths(count: number, endMonth: string): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(endMonth, i - (count - 1)));
}

/** Días entre dos fechas 'YYYY-MM-DD' (b − a). */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/**
 * Instante UTC en el que empieza un día local ('YYYY-MM-DD' a las 00:00 en la
 * zona horaria dada). Útil para filtrar columnas `timestamp` por día local.
 */
export function startOfDayInZone(dateISO: string, timeZone = DEFAULT_TIME_ZONE): Date {
  const guess = new Date(`${dateISO}T00:00:00Z`);
  const offset = zoneOffsetMs(guess, timeZone);
  const result = new Date(guess.getTime() - offset);
  // Corrige si el desfase cambia justo ese día (cambio de hora).
  const offset2 = zoneOffsetMs(result, timeZone);
  return offset2 === offset ? result : new Date(guess.getTime() - offset2);
}

/** Desfase (ms) de la zona horaria respecto a UTC en un instante dado. */
export function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

/** Hora local (0–23) y día de la semana (0 = domingo) de un instante en una zona. */
export function localHourAndWeekday(date: Date, timeZone = DEFAULT_TIME_ZONE): { hour: number; weekday: number; dateISO: string } {
  const local = new Date(date.getTime() + zoneOffsetMs(date, timeZone));
  return {
    hour: local.getUTCHours(),
    weekday: local.getUTCDay(),
    dateISO: local.toISOString().slice(0, 10),
  };
}

/** 'YYYY-MM-DDTHH:mm' (campo datetime-local) interpretado en una zona horaria → instante. */
export function parseLocalDateTime(value: string, timeZone = DEFAULT_TIME_ZONE): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value ?? "");
  if (!match || !isISODate(match[1])) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour > 23 || minute > 59) return null;
  const guess = new Date(`${match[1]}T${match[2]}:${match[3]}:00Z`);
  const first = new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
  // Segunda pasada por si el desfase cambia cerca de ese instante (cambio de hora).
  return new Date(guess.getTime() - zoneOffsetMs(first, timeZone));
}

/** Instante → 'YYYY-MM-DDTHH:mm' en una zona horaria (para rellenar un datetime-local). */
export function toLocalDateTimeInput(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  return new Date(date.getTime() + zoneOffsetMs(date, timeZone)).toISOString().slice(0, 16);
}
