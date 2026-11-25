/** Tipos compartidos del kit de gráficos. Todo es serializable (Server → Client). */

export interface ChartSeries {
  /** clave dentro de `values` de cada dato */
  key: string;
  /** nombre visible en leyenda, tooltip y tabla */
  label: string;
}

export interface ChartDatum {
  /** etiqueta corta del eje X («nov») */
  label: string;
  /** etiqueta completa para tooltip y tabla («noviembre de 2026»); por defecto, `label` */
  fullLabel?: string;
  /** valor por serie; `null` deja un hueco en la línea y cuenta como 0 en barras */
  values: Record<string, number | null | undefined>;
}

/** Codificación de una marca de área (barras, segmentos). */
export type FillMark = "solid" | "hatch" | "outline" | "muted" | "ok" | "warn" | "danger";
/** Codificación de un trazo (líneas). */
export type LineMark = "line-solid" | "line-dashed" | "line-dotted";
export type ChartMark = FillMark | LineMark;

/** Orden fijo: la serie 1 es siempre sólida/continua, la 2 trama/discontinua, la 3 contorno/punteada. */
export const FILL_MARKS: readonly FillMark[] = ["solid", "hatch", "outline"];
export const LINE_MARKS: readonly LineMark[] = ["line-solid", "line-dashed", "line-dotted"];

/** Límite del método: más de tres series no se distinguen sin tono. */
export const MAX_SERIES = 3;

export type StatusTone = "ok" | "warn" | "danger";
