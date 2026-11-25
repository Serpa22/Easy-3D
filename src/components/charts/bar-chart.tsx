"use client";

import { useId, type ReactNode } from "react";
import { scaleBand, scaleLinear } from "d3-scale";
import { ChartFrame, type ChartTableData } from "./chart-frame";
import { ChartLegend, type ChartLegendItem } from "./chart-legend";
import { ChartTexture } from "./chart-texture";
import { ChartTooltip } from "./chart-tooltip";
import { formatExact, formatShort, formatValue, type ChartFormat } from "./format";
import { barPath, buildValueAxis, layoutXLabels, MONO_CHAR } from "./scales";
import { FILL_MARKS, MAX_SERIES, type ChartDatum, type ChartSeries, type FillMark, type StatusTone } from "./types";
import { useChartCursor } from "./use-chart-cursor";

export interface BarChartProps {
  data: ChartDatum[];
  /** 1–3 series; a partir de la cuarta se ignoran */
  series: ChartSeries[];
  /** `grouped` compara series lado a lado; `stacked` las suma en una barra */
  mode?: "grouped" | "stacked";
  format?: ChartFormat;
  /** alto total en px, eje X incluido */
  height?: number;
  /** destaca la última categoría (el periodo en curso) */
  highlightLast?: boolean;
  /** con una sola serie, marca las barras negativas con un color de estado */
  negativeTone?: StatusTone;
  /** texto de la leyenda que acompaña a `negativeTone` */
  negativeLabel?: string;
  title?: string;
  description?: string;
  /** nombre accesible cuando no hay `title` visible */
  ariaLabel?: string;
  /** cabecera de la primera columna en la tabla de datos */
  categoryLabel?: string;
  emptyMessage?: string;
  className?: string;
}

const GAP = 2; // hueco de superficie entre marcas contiguas
const MAX_BAR = 24;
const RADIUS = 4;
const X_AXIS = 26;

function num(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Barras verticales sobre categorías (normalmente meses).
 * Responde a «¿cuánto en cada periodo?» y «¿qué serie es mayor?».
 */
export function BarChart({
  data,
  series: allSeries,
  mode = "grouped",
  format = "number",
  height = 240,
  highlightLast = false,
  negativeTone,
  negativeLabel = "En negativo",
  title,
  description,
  ariaLabel,
  categoryLabel = "Periodo",
  emptyMessage,
  className,
}: BarChartProps) {
  const series = allSeries.slice(0, MAX_SERIES);
  const single = series.length === 1;
  const stacked = mode === "stacked" && !single;
  const tone = single ? negativeTone : undefined;
  const hasNegative = tone !== undefined && data.some((d) => num(d.values[series[0].key]) < 0);

  // Con una serie no hay leyenda (el título ya la nombra), salvo que haya que explicar el color de estado.
  const legend: ChartLegendItem[] = single
    ? hasNegative && tone
      ? [
          { label: series[0].label, mark: "solid" },
          { label: negativeLabel, mark: tone },
        ]
      : []
    : series.map((s, i) => ({ label: s.label, mark: FILL_MARKS[i] }));

  const table: ChartTableData = {
    caption: title ?? ariaLabel ?? "Datos del gráfico",
    columns: [categoryLabel, ...series.map((s) => s.label), ...(stacked ? ["Total"] : [])],
    rows: data.map((d) => [
      d.fullLabel ?? d.label,
      ...series.map((s) => formatExact(d.values[s.key], format)),
      ...(stacked ? [formatExact(sum(d, series), format)] : []),
    ]),
  };

  return (
    <ChartFrame
      title={title}
      description={description}
      ariaLabel={ariaLabel}
      legend={legend.length > 0 ? <ChartLegend items={legend} /> : undefined}
      height={height}
      isEmpty={data.length === 0 || series.length === 0}
      emptyMessage={emptyMessage}
      table={table}
      className={className}
    >
      {(width) => (
        <BarPlot
          width={width}
          data={data}
          series={series}
          stacked={stacked}
          format={format}
          height={height}
          highlightLast={highlightLast}
          negativeTone={tone}
        />
      )}
    </ChartFrame>
  );
}

function sum(datum: ChartDatum, series: ChartSeries[]): number {
  return series.reduce((total, s) => total + num(datum.values[s.key]), 0);
}

interface BarPlotProps {
  width: number | null;
  data: ChartDatum[];
  series: ChartSeries[];
  stacked: boolean;
  format: ChartFormat;
  height: number;
  highlightLast: boolean;
  negativeTone?: StatusTone;
}

function BarPlot({ width, data, series, stacked, format, height, highlightLast, negativeTone }: BarPlotProps) {
  const textureId = `${useId()}trama`;
  const cursor = useChartCursor(data.length);
  const n = data.length;
  const k = series.length;
  const single = k === 1;

  // --- eje de valores (no depende del ancho: se pinta ya en el servidor) ---
  const extent: number[] = [];
  for (const d of data) {
    if (stacked) {
      let positive = 0;
      let negative = 0;
      for (const s of series) {
        const v = num(d.values[s.key]);
        if (v >= 0) positive += v;
        else negative += v;
      }
      extent.push(positive, negative);
    } else {
      for (const s of series) extent.push(num(d.values[s.key]));
    }
  }
  const axis = buildValueAxis(extent, format);
  const showValueLabel = highlightLast && single;
  const margin = { top: showValueLabel ? 26 : 10, right: 2, bottom: X_AXIS, left: Math.ceil(axis.labelWidth) + 12 };
  const plotBottom = height - margin.bottom;
  const y = scaleLinear().domain([axis.min, axis.max]).range([plotBottom, margin.top]);
  const crisp = (value: number) => Math.round(y(value)) + 0.5;
  const y0 = y(0);

  const barsPerGroup = stacked ? 1 : k;
  const minStep = barsPerGroup * 4 + (barsPerGroup - 1) * GAP + 6;
  const innerWidth = width === null ? null : Math.max(width, margin.left + margin.right + n * minStep);

  const grid = (
    <g aria-hidden="true">
      {axis.ticks.map((tick) => (
        <g key={tick.value}>
          {tick.value !== 0 && (
            <line
              className="chart-grid-line"
              x1={margin.left}
              x2={innerWidth === null ? "100%" : innerWidth - margin.right}
              y1={crisp(tick.value)}
              y2={crisp(tick.value)}
            />
          )}
          <text className="chart-tick" x={margin.left - 8} y={y(tick.value)} dy="0.32em" textAnchor="end">
            {tick.label}
          </text>
        </g>
      ))}
    </g>
  );

  // Sin ancho medido (servidor / primer render): solo la rejilla, con el alto definitivo.
  if (innerWidth === null || width === null) {
    return (
      <svg className="chart-svg" width="100%" height={height} aria-hidden="true">
        {grid}
        <line className="chart-axis-line" x1={margin.left} x2="100%" y1={crisp(0)} y2={crisp(0)} />
      </svg>
    );
  }

  // --- eje de categorías ---
  const right = innerWidth - margin.right;
  const x = scaleBand<number>()
    .domain(data.map((_, i) => i))
    .range([margin.left, right])
    .paddingInner(0.28)
    .paddingOuter(0.14);
  const band = x.bandwidth();
  const step = x.step();
  const barWidth = Math.max(1, Math.min(MAX_BAR, (band - (barsPerGroup - 1) * GAP) / barsPerGroup));
  const groupWidth = barsPerGroup * barWidth + (barsPerGroup - 1) * GAP;
  const groupLeft = (i: number) => (x(i) ?? 0) + (band - groupWidth) / 2;
  const columnLeft = (i: number) => (x(i) ?? 0) - (step - band) / 2;
  const columnCenter = (i: number) => (x(i) ?? 0) + band / 2;

  // --- marcas ---
  const bars: ReactNode[] = [];
  const tops: number[] = []; // punto más alto de cada columna, para saber si cabe una etiqueta
  data.forEach((d, i) => {
    const gx = groupLeft(i);
    let top = y0;
    if (stacked) {
      let positive = 0;
      let negative = 0;
      let lastPositive = -1;
      let lastNegative = -1;
      series.forEach((s, si) => {
        const v = num(d.values[s.key]);
        if (v > 0) lastPositive = si;
        if (v < 0) lastNegative = si;
      });
      series.forEach((s, si) => {
        const v = num(d.values[s.key]);
        if (v === 0) return;
        const from = v > 0 ? positive : negative;
        if (v > 0) positive += v;
        else negative += v;
        let yBase = y(from);
        const yEnd = y(from + v);
        const onBaseline = from === 0;
        // hueco de 2 px entre segmentos, salvo que el segmento sea demasiado fino
        if (!onBaseline && Math.abs(yEnd - yBase) > GAP + 1) yBase += v > 0 ? -GAP : GAP;
        const outer = si === (v > 0 ? lastPositive : lastNegative);
        bars.push(
          <Bar
            key={`${i}-${s.key}`}
            mark={FILL_MARKS[si]}
            x={gx}
            width={barWidth}
            yBase={yBase}
            yEnd={yEnd}
            radius={outer ? RADIUS : 0}
            onBaseline={onBaseline}
            textureId={textureId}
          />,
        );
        top = Math.min(top, yEnd);
      });
    } else {
      series.forEach((s, si) => {
        const v = num(d.values[s.key]);
        if (v === 0) return;
        let yEnd = y(v);
        // un valor distinto de cero siempre deja marca visible
        if (Math.abs(yEnd - y0) < 1.5) yEnd = y0 + (v > 0 ? -1.5 : 1.5);
        let mark: FillMark = FILL_MARKS[si];
        if (single) {
          if (v < 0 && negativeTone) mark = negativeTone;
          else if (highlightLast && i !== n - 1) mark = "muted";
        }
        bars.push(
          <Bar
            key={`${i}-${s.key}`}
            mark={mark}
            x={gx + si * (barWidth + GAP)}
            width={barWidth}
            yBase={y0}
            yEnd={yEnd}
            radius={RADIUS}
            onBaseline
            textureId={textureId}
          />,
        );
        top = Math.min(top, yEnd);
      });
    }
    tops.push(top);
  });

  // --- etiqueta directa: solo la barra destacada, y solo si cabe sin pisar a sus vecinas ---
  let valueLabel: ReactNode = null;
  if (showValueLabel && n > 0) {
    const i = n - 1;
    const v = num(data[i].values[series[0].key]);
    const text = formatShort(v, format);
    const half = (text.length * MONO_CHAR) / 2;
    const cx = Math.min(Math.max(columnCenter(i), margin.left + half), innerWidth - half);
    // sobre el extremo si es positiva; sobre la línea base si cuelga hacia abajo
    const baseline = (v >= 0 ? tops[i] : y0) - 7;
    const collides = tops.some((top, j) => {
      if (j === i || top > baseline + 3) return false;
      const left = groupLeft(j);
      return left + groupWidth > cx - half - 3 && left < cx + half + 3;
    });
    if (!collides) {
      valueLabel = (
        <text className="chart-value-label" x={cx} y={baseline} textAnchor="middle" aria-hidden="true">
          {text}
        </text>
      );
    }
  }

  const labels = layoutXLabels(
    data.map((d) => d.label),
    step,
  );
  const active = cursor.active;
  const activeDatum = active !== null ? data[active] : null;
  const describe = (d: ChartDatum) => {
    const name = d.fullLabel ?? d.label;
    if (single) return `${name}: ${formatValue(d.values[series[0].key], format)}`;
    const parts = series.map((s) => `${s.label} ${formatValue(d.values[s.key], format)}`);
    if (stacked) parts.push(`total ${formatValue(sum(d, series), format)}`);
    return `${name}: ${parts.join(", ")}`;
  };

  return (
    <>
      <svg
        ref={cursor.rootRef}
        className="chart-svg"
        width={innerWidth}
        height={height}
        role="group"
        aria-label="Valores por categoría. Usa las flechas izquierda y derecha para recorrerlos."
        style={innerWidth > width ? { touchAction: "auto" } : undefined}
      >
        <defs>
          <ChartTexture id={textureId} />
        </defs>
        {grid}
        {(active !== null || (highlightLast && !single && n > 0)) && (
          <rect
            aria-hidden="true"
            className="chart-band"
            x={columnLeft(active ?? n - 1)}
            y={margin.top - 3}
            width={step}
            height={plotBottom - margin.top + 6}
            rx={4}
          />
        )}
        <g className="chart-marks" aria-hidden="true">
          {bars}
          {valueLabel}
        </g>
        <line className="chart-axis-line" aria-hidden="true" x1={margin.left} x2={right} y1={crisp(0)} y2={crisp(0)} />
        <g aria-hidden="true">
          {labels.map(
            (label, i) =>
              label.show && (
                <text
                  key={i}
                  className="chart-xlabel"
                  data-strong={highlightLast && i === n - 1}
                  x={Math.min(Math.max(columnCenter(i), label.width / 2), innerWidth - label.width / 2)}
                  y={height - 8}
                  textAnchor="middle"
                >
                  {label.text}
                </text>
              ),
          )}
        </g>
        <g {...cursor.pointerProps((px) => Math.floor((px - columnLeft(0)) / step))}>
          {data.map((d, i) => (
            <rect
              key={i}
              className="chart-hit"
              x={columnLeft(i)}
              y={margin.top - 3}
              width={step}
              height={plotBottom - margin.top + 6}
              rx={4}
              role="img"
              aria-label={describe(d)}
              {...cursor.hitProps(i)}
            />
          ))}
        </g>
      </svg>
      {active !== null && activeDatum && (
        <ChartTooltip
          x={columnCenter(active)}
          top={margin.top}
          offset={step / 2 + 6}
          containerWidth={innerWidth}
          title={activeDatum.fullLabel ?? activeDatum.label}
          rows={series.map((s, si) => ({
            label: s.label,
            value: formatValue(activeDatum.values[s.key], format),
            mark: single ? undefined : FILL_MARKS[si],
          }))}
          footer={stacked ? { label: "Total", value: formatValue(sum(activeDatum, series), format) } : undefined}
        />
      )}
    </>
  );
}

interface BarProps {
  mark: FillMark;
  x: number;
  width: number;
  yBase: number;
  yEnd: number;
  radius: number;
  /** la barra nace en la línea base (el contorno no la repite) */
  onBaseline: boolean;
  textureId: string;
}

function Bar({ mark, x, width, yBase, yEnd, radius, onBaseline, textureId }: BarProps) {
  if (mark === "outline") {
    const inset = 0.75; // medio trazo: el contorno ocupa lo mismo que una barra rellena
    const length = Math.abs(yBase - yEnd);
    // demasiado pequeña para un contorno hueco: se rellena con el mismo gris
    if (length < 4 || width < 4) return <path d={barPath(x, width, yBase, yEnd, radius)} className="chart-mark-muted" />;
    const dir = yEnd <= yBase ? 1 : -1;
    return (
      <path
        d={barPath(
          x + inset,
          width - inset * 2,
          onBaseline ? yBase : yBase - dir * inset,
          yEnd + dir * inset,
          Math.max(0, radius - inset),
          !onBaseline,
        )}
        className="chart-mark-outline"
      />
    );
  }
  const d = barPath(x, width, yBase, yEnd, radius);
  if (mark === "hatch") return <path d={d} fill={`url(#${textureId})`} />;
  return <path d={d} className={`chart-mark-${mark}`} />;
}
