/**
 * Formato de valores para gráficos.
 *
 * Las páginas son Server Components y no pueden pasar funciones a los gráficos
 * (Client Components), así que el formato viaja como una cadena serializable
 * (`format="money"`) y aquí se traduce a los formateadores de `@/lib/format`.
 *
 * Unidades de entrada: dinero en céntimos enteros, horas en segundos, peso en
 * gramos, porcentaje de 0 a 100.
 */
import {
  formatHours,
  formatKwh,
  formatMoney,
  formatMoneyCompact,
  formatMoneyRound,
  formatNumber,
  formatPercent,
  formatWeight,
  LOCALE,
} from "@/lib/format";

export type ChartFormat = "money" | "moneyCompact" | "number" | "percent" | "kwh" | "hours" | "weight" | "count";

const compactNumber = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 });

/** Valor tal como se muestra en etiquetas, tooltips y leyendas. */
export function formatValue(value: number | null | undefined, format: ChartFormat = "number"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  switch (format) {
    case "money":
      return formatMoney(value);
    case "moneyCompact":
      return formatMoneyCompact(value);
    case "percent":
      return formatPercent(value, 1);
    case "kwh":
      return formatKwh(value);
    case "hours":
      return formatHours(value);
    case "weight":
      return formatWeight(value);
    case "count":
      return formatNumber(value, 0);
    default:
      return formatNumber(value, 2);
  }
}

/** Valor exacto para la tabla alternativa (nunca compacto). */
export function formatExact(value: number | null | undefined, format: ChartFormat = "number"): string {
  return formatValue(value, format === "moneyCompact" ? "money" : format);
}

/** Valor corto para etiquetas directas sobre el gráfico (donde el espacio manda). */
export function formatShort(value: number | null | undefined, format: ChartFormat = "number"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (format === "money" || format === "moneyCompact") {
    return Math.abs(value) >= 1_000_000 ? formatMoneyCompact(value) : formatMoneyRound(value);
  }
  if ((format === "number" || format === "count") && Math.abs(value) >= 10_000) return compactNumber.format(value);
  return formatValue(value, format);
}

export interface AxisUnit {
  /** valor bruto ÷ divisor = unidad en la que se eligen marcas redondas */
  divisor: number;
  /** solo marcas enteras (recuentos) */
  integer: boolean;
  /** etiqueta de una marca, recibiendo el valor ya en unidades del eje */
  label: (units: number) => string;
}

/**
 * Unidad del eje de valores. Un solo estilo por eje: cifras completas por
 * debajo de 10.000 y compactas cuando el eje las alcanza.
 */
export function axisUnit(format: ChartFormat, maxAbs: number): AxisUnit {
  switch (format) {
    case "money":
    case "moneyCompact": {
      const compact = maxAbs / 100 >= 10_000;
      return {
        divisor: 100,
        integer: false,
        label: (u) => {
          const cents = Math.round(u * 100);
          if (compact) return formatMoneyCompact(cents);
          return Number.isInteger(u) ? formatMoneyRound(cents) : formatMoney(cents);
        },
      };
    }
    case "hours":
      return { divisor: 3600, integer: false, label: (u) => `${axisNumber(u, maxAbs / 3600)} h` };
    case "weight": {
      const kilos = maxAbs >= 1000;
      const divisor = kilos ? 1000 : 1;
      return { divisor, integer: false, label: (u) => `${axisNumber(u, maxAbs / divisor)} ${kilos ? "kg" : "g"}` };
    }
    case "kwh":
      return { divisor: 1, integer: false, label: (u) => `${axisNumber(u, maxAbs)} kWh` };
    case "percent":
      return { divisor: 1, integer: false, label: (u) => `${formatNumber(u, 2)} %` };
    case "count":
      return { divisor: 1, integer: true, label: (u) => axisNumber(u, maxAbs) };
    default:
      return { divisor: 1, integer: false, label: (u) => axisNumber(u, maxAbs) };
  }
}

function axisNumber(units: number, maxUnits: number): string {
  return maxUnits >= 10_000 ? compactNumber.format(units) : formatNumber(units, 2);
}
