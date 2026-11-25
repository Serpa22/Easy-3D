/**
 * Electricidad: consumo y coste. Funciones puras (isomórficas).
 *
 * Tarifa por periodos = peaje 2.0TD de España (península):
 *   - Laborables: valle 00–08 h · llano 08–10, 14–18 y 22–24 h · punta 10–14 y 18–22 h
 *   - Sábados, domingos, 6 de enero y festivos nacionales de fecha fija: todo valle
 */
import type { ElectricityMode, TariffPeriod } from "./domain";
import { DEFAULT_TIME_ZONE } from "./format";
import { localHourAndWeekday } from "./dates";

export interface ElectricityTariff {
  electricityMode: ElectricityMode;
  kwhPrice: number;
  kwhPricePeak: number;
  kwhPriceFlat: number;
  kwhPriceValley: number;
}

/** Festivos nacionales de fecha fija (MM-DD) que cuentan como valle todo el día. */
const NATIONAL_HOLIDAYS = new Set(["01-01", "01-06", "05-01", "08-15", "10-12", "11-01", "12-06", "12-08", "12-25"]);

/** Periodo tarifario 2.0TD de una hora local de un día laborable. */
export function weekdayPeriodForHour(hour: number): TariffPeriod {
  if (hour < 8) return "valley";
  if ((hour >= 10 && hour < 14) || (hour >= 18 && hour < 22)) return "peak";
  return "flat";
}

/** Periodo tarifario 2.0TD vigente en un instante. */
export function tariffPeriodAt(date: Date, timeZone = DEFAULT_TIME_ZONE): TariffPeriod {
  const { hour, weekday, dateISO } = localHourAndWeekday(date, timeZone);
  if (weekday === 0 || weekday === 6) return "valley";
  if (NATIONAL_HOLIDAYS.has(dateISO.slice(5))) return "valley";
  return weekdayPeriodForHour(hour);
}

/** Reparte una duración entre periodos tarifarios (en segundos). */
export function splitSecondsByPeriod(
  start: Date,
  durationSec: number,
  timeZone = DEFAULT_TIME_ZONE,
): Record<TariffPeriod, number> {
  const out: Record<TariffPeriod, number> = { peak: 0, flat: 0, valley: 0 };
  let cursor = start.getTime();
  const end = cursor + Math.max(0, durationSec) * 1000;
  // Avanza hasta cada cambio de hora en punto (los periodos cambian en horas en punto;
  // los husos con desfase de :30/:45 quedan aproximados al cuarto de hora).
  const STEP = 15 * 60 * 1000;
  while (cursor < end) {
    const next = Math.min(end, Math.floor(cursor / STEP) * STEP + STEP);
    out[tariffPeriodAt(new Date(cursor), timeZone)] += (next - cursor) / 1000;
    cursor = next;
  }
  return out;
}

/** kWh consumidos por una potencia media (W) durante unos segundos. */
export function energyKwh(watts: number, seconds: number): number {
  return (Math.max(0, watts) * Math.max(0, seconds)) / 3_600_000;
}

/** Precio de un periodo según la tarifa. */
export function priceForPeriod(tariff: ElectricityTariff, period: TariffPeriod): number {
  if (tariff.electricityMode === "fixed") return tariff.kwhPrice;
  if (period === "peak") return tariff.kwhPricePeak;
  if (period === "flat") return tariff.kwhPriceFlat;
  return tariff.kwhPriceValley;
}

/**
 * Precio medio €/kWh para estimaciones sin horario concreto. Con tarifa por
 * periodos pondera por las horas semanales de cada uno (valle 88 h, llano 40 h,
 * punta 40 h de 168).
 */
export function averageKwhPrice(tariff: ElectricityTariff): number {
  if (tariff.electricityMode === "fixed") return tariff.kwhPrice;
  return (tariff.kwhPriceValley * 88 + tariff.kwhPriceFlat * 40 + tariff.kwhPricePeak * 40) / 168;
}

export interface EnergyCost {
  kwh: number;
  costCents: number;
  /** kWh por periodo (con tarifa fija todo va a «flat»). */
  kwhByPeriod: Record<TariffPeriod, number>;
}

/** Consumo y coste de un uso concreto (una impresión) con hora de inicio real. */
export function energyCost(
  tariff: ElectricityTariff,
  usage: { start: Date; durationSec: number; watts: number; timeZone?: string },
): EnergyCost {
  const kwh = energyKwh(usage.watts, usage.durationSec);
  if (tariff.electricityMode === "fixed") {
    return {
      kwh,
      costCents: Math.round(kwh * tariff.kwhPrice * 100),
      kwhByPeriod: { peak: 0, flat: kwh, valley: 0 },
    };
  }
  const seconds = splitSecondsByPeriod(usage.start, usage.durationSec, usage.timeZone);
  const kwhByPeriod: Record<TariffPeriod, number> = {
    peak: energyKwh(usage.watts, seconds.peak),
    flat: energyKwh(usage.watts, seconds.flat),
    valley: energyKwh(usage.watts, seconds.valley),
  };
  const euros =
    kwhByPeriod.peak * tariff.kwhPricePeak +
    kwhByPeriod.flat * tariff.kwhPriceFlat +
    kwhByPeriod.valley * tariff.kwhPriceValley;
  return { kwh, costCents: Math.round(euros * 100), kwhByPeriod };
}
