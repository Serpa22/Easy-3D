/**
 * Formato de cifras, dinero, fechas y duraciones para la interfaz (es-ES).
 * Isomórfico: funciona igual en servidor y navegador. Las fechas se muestran
 * siempre en la zona horaria de la organización para que servidor y cliente
 * pinten lo mismo.
 */

export const LOCALE = "es-ES";
export const CURRENCY = "EUR";
export const DEFAULT_TIME_ZONE = "Europe/Madrid";

// `useGrouping: "always"`: en es-ES los números de 4 cifras no llevan punto de
// miles por defecto («1234,56 €»); en importes queremos siempre «1.234,56 €».
const money = new Intl.NumberFormat(LOCALE, { style: "currency", currency: CURRENCY, useGrouping: "always" });
const moneyNoCents = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  maximumFractionDigits: 0,
  useGrouping: "always",
});
const moneyCompact = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  notation: "compact",
  maximumFractionDigits: 1,
});

/** 123456 → «1.234,56 €» */
export function formatMoney(cents: number | null | undefined): string {
  return money.format((cents ?? 0) / 100);
}
/** 123456 → «1.235 €» (sin céntimos, para KPIs grandes) */
export function formatMoneyRound(cents: number | null | undefined): string {
  return moneyNoCents.format(Math.round((cents ?? 0) / 100));
}
/** 1234567 → «12,3 mil €» (ejes de gráficos) */
export function formatMoneyCompact(cents: number | null | undefined): string {
  return moneyCompact.format((cents ?? 0) / 100);
}
/** Con signo explícito: «+12,00 €» / «−5,00 €» */
export function formatMoneySigned(cents: number): string {
  const abs = money.format(Math.abs(cents) / 100);
  if (cents > 0) return `+${abs}`;
  if (cents < 0) return `−${abs}`;
  return abs;
}
/** Céntimos → «12,50» para rellenar un campo de formulario. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function formatNumber(value: number | null | undefined, maxDecimals = 2): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: maxDecimals, useGrouping: "always" }).format(value ?? 0);
}
/** Número → texto para un campo de formulario («1,5»). */
export function numberToInput(value: number | null | undefined, maxDecimals = 3): string {
  if (value === null || value === undefined) return "";
  return String(Number(value.toFixed(maxDecimals))).replace(".", ",");
}
export function formatPercent(value: number | null | undefined, maxDecimals = 0): string {
  return `${formatNumber(value ?? 0, maxDecimals)} %`;
}

/** Gramos → «850 g» / «1,25 kg» */
export function formatWeight(grams: number | null | undefined): string {
  const g = grams ?? 0;
  if (Math.abs(g) >= 1000) return `${formatNumber(g / 1000, 2)} kg`;
  return `${formatNumber(g, g < 10 ? 1 : 0)} g`;
}
/** Mililitros → «250 ml» / «1,5 L» */
export function formatVolume(ml: number | null | undefined): string {
  const v = ml ?? 0;
  if (Math.abs(v) >= 1000) return `${formatNumber(v / 1000, 2)} L`;
  return `${formatNumber(v, 0)} ml`;
}
/** Cantidad de material según su unidad (g / ml / ud). */
export function formatQty(qty: number | null | undefined, unit: "g" | "ml" | "ud"): string {
  if (unit === "g") return formatWeight(qty);
  if (unit === "ml") return formatVolume(qty);
  return `${formatNumber(qty ?? 0, 0)} ud`;
}
export function formatKwh(kwh: number | null | undefined): string {
  const v = kwh ?? 0;
  return `${formatNumber(v, v < 10 ? 2 : 1)} kWh`;
}
export function formatWatts(w: number | null | undefined): string {
  return `${formatNumber(w ?? 0, 0)} W`;
}
export function formatTemp(celsius: number | null | undefined): string {
  if (celsius === null || celsius === undefined) return "—";
  return `${Math.round(celsius)} °C`;
}

/** Segundos → «2 h 05 min» / «45 min» / «30 s» */
export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds ?? 0));
  if (s < 60) return `${s} s`;
  const totalMin = Math.round(s / 60);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  return `${m} min`;
}
/** Segundos → horas con un decimal: «12,5 h» */
export function formatHours(seconds: number | null | undefined): string {
  return `${formatNumber((seconds ?? 0) / 3600, 1)} h`;
}

type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  // 'YYYY-MM-DD' (fecha contable): se interpreta a mediodía UTC para que no
  // salte de día al formatear en ninguna zona horaria.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00Z`);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** «25 nov 2026» */
export function formatDate(value: DateInput, timeZone = DEFAULT_TIME_ZONE): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone }).format(d);
}
/** «25 de noviembre de 2026» (contratos) */
export function formatDateLong(value: DateInput, timeZone = DEFAULT_TIME_ZONE): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric", timeZone }).format(d);
}
/** «25/11/2026» (documentos impresos) */
export function formatDateNumeric(value: DateInput, timeZone = DEFAULT_TIME_ZONE): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric", timeZone }).format(d);
}
/** «25 nov» */
export function formatDateShort(value: DateInput, timeZone = DEFAULT_TIME_ZONE): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone }).format(d);
}
/** «25 nov 2026, 14:32» */
export function formatDateTime(value: DateInput, timeZone = DEFAULT_TIME_ZONE): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(d);
}
/** «14:32» */
export function formatTime(value: DateInput, timeZone = DEFAULT_TIME_ZONE): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", timeZone }).format(d);
}
/** «noviembre de 2026» a partir de 'YYYY-MM' o una fecha. */
export function formatMonth(value: DateInput, timeZone = DEFAULT_TIME_ZONE): string {
  const v = typeof value === "string" && /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
  const d = toDate(v);
  if (!d) return "—";
  return new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone }).format(d);
}
/** «nov» / «nov 26» a partir de 'YYYY-MM' (etiquetas de ejes). */
export function formatMonthShort(value: string, withYear = false): string {
  const d = toDate(`${value.slice(0, 7)}-01`);
  if (!d) return "—";
  const month = new Intl.DateTimeFormat(LOCALE, { month: "short", timeZone: "UTC" }).format(d).replace(".", "");
  return withYear ? `${month} ${value.slice(2, 4)}` : month;
}

/** «hace 5 min», «hace 2 h», «ayer»… (`now` inyectable para tests y SSR estable). */
export function formatRelative(value: DateInput, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return "—";
  const diffSec = Math.round((d.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto", style: "short" });
  if (abs < 45) return "ahora";
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diffSec / (86400 * 30)), "month");
  return rtf.format(Math.round(diffSec / (86400 * 365)), "year");
}
