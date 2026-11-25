"use client";

import { scaleLinear, scalePoint } from "d3-scale";
import { area as areaShape, curveMonotoneX, line as lineShape } from "d3-shape";
import { ChartFrame, type ChartTableData } from "./chart-frame";
import { ChartLegend } from "./chart-legend";
import { ChartTooltip } from "./chart-tooltip";
import { formatExact, formatShort, formatValue, type ChartFormat } from "./format";
import { buildValueAxis, dodge, layoutXLabels, MONO_CHAR, truncate } from "./scales";
import { LINE_MARKS, MAX_SERIES, type ChartDatum, type ChartSeries } from "./types";
import { useChartCursor } from "./use-chart-cursor";

export interface LineChartProps {
  data: ChartDatum[];
  /** 1–3 series; a partir de la cuarta se ignoran */
  series: ChartSeries[];
  /** rellena bajo la línea con un lavado al 10 % (solo la primera serie si hay varias) */
  area?: boolean;
  format?: ChartFormat;
  /** alto total en px, eje X incluido */
  height?: number;
  /** etiqueta directa al final de cada línea; se omite sola si el gráfico es estrecho */
  endLabels?: boolean;
  title?: string;
  description?: string;
  /** nombre accesible cuando no hay `title` visible */
  ariaLabel?: string;
  /** cabecera de la primera columna en la tabla de datos */
  categoryLabel?: string;
  emptyMessage?: string;
  className?: string;
}

const X_AXIS = 26;
const END_LABEL_CHAR = 6.7; // sans a 12 px
const MIN_PLOT_FOR_END_LABELS = 260;

type Point = number | null;

function point(value: number | null | undefined): Point {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Serie temporal como línea (o área).
 * Responde a «¿cómo evoluciona?»: la forma de la curva importa más que cada cifra.
 */
export function LineChart({
  data,
  series: allSeries,
  area = false,
  format = "number",
  height = 240,
  endLabels = true,
  title,
  description,
  ariaLabel,
  categoryLabel = "Periodo",
  emptyMessage,
  className,
}: LineChartProps) {
  const series = allSeries.slice(0, MAX_SERIES);

  const table: ChartTableData = {
    caption: title ?? ariaLabel ?? "Datos del gráfico",
    columns: [categoryLabel, ...series.map((s) => s.label)],
    rows: data.map((d) => [d.fullLabel ?? d.label, ...series.map((s) => formatExact(d.values[s.key], format))]),
  };

  return (
    <ChartFrame
      title={title}
      description={description}
      ariaLabel={ariaLabel}
      legend={
        series.length > 1 ? (
          <ChartLegend items={series.map((s, i) => ({ label: s.label, mark: LINE_MARKS[i] }))} />
        ) : undefined
      }
      height={height}
      isEmpty={data.length === 0 || series.length === 0}
      emptyMessage={emptyMessage}
      table={table}
      className={className}
    >
      {(width) => (
        <LinePlot
          width={width}
          data={data}
          series={series}
          area={area}
          format={format}
          height={height}
          endLabels={endLabels}
        />
      )}
    </ChartFrame>
  );
}

interface LinePlotProps {
  width: number | null;
  data: ChartDatum[];
  series: ChartSeries[];
  area: boolean;
  format: ChartFormat;
  height: number;
  endLabels: boolean;
}

function LinePlot({ width, data, series, area, format, height, endLabels }: LinePlotProps) {
  const cursor = useChartCursor(data.length);
  const n = data.length;
  const single = series.length === 1;

  const columns = series.map((s) => data.map((d) => point(d.values[s.key])));
  const axis = buildValueAxis(
    columns.flat().filter((v): v is number => v !== null),
    format,
  );

  // Etiqueta al final de la línea: el valor si hay una serie; el nombre si hay
  // varias (ahí lo que está en juego es la identidad, no la cifra).
  const ends = columns.map((values, si) => {
    let index = n - 1;
    while (index >= 0 && values[index] === null) index--;
    if (index < 0) return null;
    const value = values[index] as number;
    return { index, value, text: single ? formatShort(value, format) : truncate(series[si].label, 16) };
  });
  const gutter =
    Math.max(0, ...ends.map((end) => (end ? end.text.length : 0))) * (single ? MONO_CHAR : END_LABEL_CHAR) + 16;
  const left = Math.ceil(axis.labelWidth) + 12;
  const showEndLabels = endLabels && width !== null && width - left - gutter >= MIN_PLOT_FOR_END_LABELS;
  const margin = { top: 12, right: showEndLabels ? Math.ceil(gutter) : 8, bottom: X_AXIS, left };

  const plotBottom = height - margin.bottom;
  const y = scaleLinear().domain([axis.min, axis.max]).range([plotBottom, margin.top]);
  const crisp = (value: number) => Math.round(y(value)) + 0.5;

  const grid = (
    <g aria-hidden="true">
      {axis.ticks.map((tick) => (
        <g key={tick.value}>
          {tick.value !== 0 && (
            <line
              className="chart-grid-line"
              x1={margin.left}
              x2={width === null ? "100%" : width - margin.right}
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
  if (width === null) {
    return (
      <svg className="chart-svg" width="100%" height={height} aria-hidden="true">
        {grid}
        <line className="chart-axis-line" x1={margin.left} x2="100%" y1={crisp(0)} y2={crisp(0)} />
      </svg>
    );
  }

  const right = width - margin.right;
  const x = scalePoint<number>()
    .domain(data.map((_, i) => i))
    .range([margin.left + 6, right]);
  const px = (i: number) => x(i) ?? margin.left;
  const step = n > 1 ? x.step() : right - margin.left;

  const path = lineShape<Point>()
    .defined((v) => v !== null)
    .x((_, i) => px(i))
    .y((v) => y(v ?? 0))
    .curve(curveMonotoneX);
  const fill = areaShape<Point>()
    .defined((v) => v !== null)
    .x((_, i) => px(i))
    .y0(y(0))
    .y1((v) => y(v ?? 0))
    .curve(curveMonotoneX);

  // Si las etiquetas finales chocan no se apilan sin más: se separan y se unen a su línea con una guía.
  const labelY = dodge(
    ends.map((end) => (end ? y(end.value) : plotBottom)),
    15,
    margin.top + 2,
    plotBottom - 2,
  );

  const labels = layoutXLabels(
    data.map((d) => d.label),
    step,
  );
  const active = cursor.active;
  const activeDatum = active !== null ? data[active] : null;
  const describe = (d: ChartDatum) => {
    const name = d.fullLabel ?? d.label;
    if (single) return `${name}: ${formatValue(d.values[series[0].key], format)}`;
    return `${name}: ${series.map((s) => `${s.label} ${formatValue(d.values[s.key], format)}`).join(", ")}`;
  };
  const columnLeft = (i: number) => Math.max(margin.left, px(i) - step / 2);
  const columnRight = (i: number) => Math.min(width - 1, px(i) + step / 2);

  return (
    <>
      <svg
        ref={cursor.rootRef}
        className="chart-svg"
        width={width}
        height={height}
        role="group"
        aria-label="Valores por periodo. Usa las flechas izquierda y derecha para recorrerlos."
      >
        {grid}
        <line className="chart-axis-line" aria-hidden="true" x1={margin.left} x2={right} y1={crisp(0)} y2={crisp(0)} />
        {active !== null && (
          <line
            aria-hidden="true"
            className="chart-cursor-line"
            x1={Math.round(px(active)) + 0.5}
            x2={Math.round(px(active)) + 0.5}
            y1={margin.top}
            y2={plotBottom}
          />
        )}
        <g className="chart-marks" aria-hidden="true">
          {area &&
            columns.map(
              (values, si) =>
                (single || si === 0) && (
                  <path key={series[si].key} d={fill(values) ?? undefined} className={`chart-area chart-area-${si + 1}`} />
                ),
            )}
          {/* la serie 1 se pinta la última: queda encima donde las líneas se cruzan */}
          {columns
            .map((values, si) => (
              <path key={series[si].key} d={path(values) ?? undefined} className={`chart-line chart-line-${si + 1}`} />
            ))
            .reverse()}
          {ends.map(
            (end, si) =>
              end && (
                <circle
                  key={series[si].key}
                  className={`chart-dot chart-dot-${si + 1}`}
                  cx={px(end.index)}
                  cy={y(end.value)}
                  r={5}
                />
              ),
          )}
          {showEndLabels &&
            ends.map((end, si) => {
              if (!end || end.index !== n - 1) return null;
              const dotY = y(end.value);
              const textX = px(end.index) + 12;
              return (
                <g key={series[si].key}>
                  {Math.abs(labelY[si] - dotY) > 4 && (
                    <line className="chart-leader" x1={textX - 6} y1={dotY} x2={textX - 2} y2={labelY[si]} />
                  )}
                  <text
                    className={single ? "chart-value-label" : "chart-end-label"}
                    x={textX}
                    y={labelY[si]}
                    dy="0.32em"
                  >
                    {end.text}
                  </text>
                </g>
              );
            })}
        </g>
        {activeDatum && active !== null && (
          <g aria-hidden="true">
            {columns.map((values, si) => {
              const v = values[active];
              return (
                v !== null && (
                  <circle
                    key={series[si].key}
                    className={`chart-dot chart-dot-${si + 1}`}
                    cx={px(active)}
                    cy={y(v)}
                    r={5}
                  />
                )
              );
            })}
          </g>
        )}
        <g aria-hidden="true">
          {labels.map(
            (label, i) =>
              label.show && (
                <text
                  key={i}
                  className="chart-xlabel"
                  x={Math.min(Math.max(px(i), label.width / 2), width - label.width / 2)}
                  y={height - 8}
                  textAnchor="middle"
                >
                  {label.text}
                </text>
              ),
          )}
        </g>
        <g {...cursor.pointerProps((pointerX) => Math.round((pointerX - px(0)) / step))}>
          {data.map((d, i) => (
            <rect
              key={i}
              className="chart-hit"
              x={columnLeft(i)}
              y={margin.top - 3}
              width={Math.max(1, columnRight(i) - columnLeft(i))}
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
          x={px(active)}
          top={margin.top}
          offset={14}
          containerWidth={width}
          title={activeDatum.fullLabel ?? activeDatum.label}
          rows={series.map((s, si) => ({
            label: s.label,
            value: formatValue(activeDatum.values[s.key], format),
            mark: single ? undefined : LINE_MARKS[si],
          }))}
        />
      )}
    </>
  );
}
