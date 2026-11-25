/** Geometría compartida: eje de valores, etiquetas del eje X y trazado de barras. */
import { axisUnit, type ChartFormat } from "./format";

/** Ancho aproximado por carácter a 11 px (Geist Mono es exacto: 0,6 em). */
export const MONO_CHAR = 6.6;
export const SANS_CHAR = 6.1;

export interface ValueAxis {
  min: number;
  max: number;
  ticks: { value: number; label: string }[];
  /** ancho que hay que reservar para las etiquetas del eje */
  labelWidth: number;
}

const STEPS = [1, 2, 2.5, 5, 10];

/**
 * Eje de valores con 3–5 marcas redondas. Siempre incluye el cero: las barras
 * crecen desde la línea base y un eje truncado exagera las diferencias.
 */
export function buildValueAxis(values: number[], format: ChartFormat): ValueAxis {
  const finite = values.filter((v) => Number.isFinite(v));
  const rawMin = Math.min(0, ...finite);
  const rawMax = Math.max(0, ...finite);
  const unit = axisUnit(format, Math.max(Math.abs(rawMin), Math.abs(rawMax)));

  const lo = rawMin / unit.divisor;
  const hi = rawMax / unit.divisor;

  // Todo a cero: una sola marca en la base, sin inventar una escala.
  if (lo === 0 && hi === 0) {
    const label = unit.label(0);
    return { min: 0, max: unit.divisor, ticks: [{ value: 0, label }], labelWidth: label.length * MONO_CHAR };
  }

  const span = hi - lo;
  const raw = span / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const candidates = [pow, pow * 10, pow * 100]
    .flatMap((p) => STEPS.map((s) => s * p))
    .filter((s) => s >= raw * 0.999 && (!unit.integer || Number.isInteger(s)));
  if (unit.integer && candidates.length === 0) candidates.push(1);

  let step = candidates[0];
  let start = 0;
  let end = 0;
  for (const candidate of candidates) {
    step = candidate;
    start = Math.floor(lo / step + 1e-9) * step;
    end = Math.ceil(hi / step - 1e-9) * step;
    if (Math.round((end - start) / step) <= 4) break;
  }

  const count = Math.round((end - start) / step);
  const ticks = Array.from({ length: count + 1 }, (_, i) => {
    // se redondea para no arrastrar errores de coma flotante (0,30000000004)
    const units = Number((start + i * step).toPrecision(12));
    return { value: units * unit.divisor, label: unit.label(units) };
  });
  const labelWidth = Math.max(...ticks.map((t) => t.label.length)) * MONO_CHAR;
  return { min: start * unit.divisor, max: end * unit.divisor, ticks, labelWidth };
}

export interface XLabel {
  text: string;
  show: boolean;
  /** ancho estimado del texto ya recortado */
  width: number;
}

/**
 * Etiquetas del eje X que nunca chocan: si no caben todas, primero se recortan
 * las largas y después se muestran una de cada N, conservando siempre la última
 * (el periodo más reciente).
 */
export function layoutXLabels(labels: string[], step: number): XLabel[] {
  const gap = 10;
  const longest = Math.max(0, ...labels.map((l) => l.length));
  let chars = longest;
  if (chars * SANS_CHAR + gap > step && longest > 8) {
    chars = Math.max(8, Math.floor((step - gap) / SANS_CHAR));
  }
  const every = Math.max(1, Math.ceil((Math.min(chars, longest) * SANS_CHAR + gap) / Math.max(step, 1)));
  const last = labels.length - 1;
  return labels.map((label, i) => {
    const text = truncate(label, chars);
    return { text, show: (last - i) % every === 0, width: text.length * SANS_CHAR };
  });
}

export function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…` : text;
}

/**
 * Barra con el extremo del dato redondeado y la base recta.
 * `yBase` es la línea base (o el borde hacia ella) e `yEnd` el extremo del dato;
 * funciona igual hacia arriba (positivos) que hacia abajo (negativos).
 */
export function barPath(
  x: number,
  width: number,
  yBase: number,
  yEnd: number,
  radius: number,
  /** `false` deja la base sin cerrar (el contorno no repite la línea base) */
  closed = true,
): string {
  const dir = yEnd <= yBase ? 1 : -1; // 1 = crece hacia arriba
  const r = Math.max(0, Math.min(radius, width / 2, Math.abs(yBase - yEnd)));
  const x2 = x + width;
  const end = closed ? "Z" : "";
  if (r === 0) return `M${x},${yBase}V${yEnd}H${x2}V${yBase}${end}`;
  const yr = yEnd + dir * r;
  return `M${x},${yBase}V${yr}Q${x},${yEnd} ${x + r},${yEnd}H${x2 - r}Q${x2},${yEnd} ${x2},${yr}V${yBase}${end}`;
}

/** Separa etiquetas que chocan en vertical manteniendo el orden (mínimo `gap` px entre ellas). */
export function dodge(positions: number[], gap: number, min: number, max: number): number[] {
  const order = positions.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) {
    if (order[k].y - order[k - 1].y < gap) order[k].y = order[k - 1].y + gap;
  }
  // si la última se sale por abajo, se empuja todo el bloque hacia arriba
  const lastIndex = order.length - 1;
  if (lastIndex >= 0 && order[lastIndex].y > max) {
    order[lastIndex].y = max;
    for (let k = lastIndex - 1; k >= 0; k--) {
      if (order[k + 1].y - order[k].y >= gap) break;
      order[k].y = order[k + 1].y - gap;
    }
  }
  const out = [...positions];
  for (const o of order) out[o.i] = Math.max(min, o.y);
  return out;
}
