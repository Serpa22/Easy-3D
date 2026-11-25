"use client";

import { cn } from "@/lib/cn";
import { ChartSwatch } from "./chart-legend";
import type { ChartMark } from "./types";
import { useElementSize } from "./use-element-size";

export interface ChartTooltipRow {
  label: string;
  value: string;
  mark?: ChartMark;
}

export interface ChartTooltipProps {
  /** centro de la posición activa, en px dentro del contenedor del gráfico */
  x: number;
  /** borde superior de la zona de dibujo */
  top: number;
  /** distancia a la que se aparta del centro para no tapar la marca activa */
  offset: number;
  /** ancho del contenedor: el tooltip nunca se sale de él */
  containerWidth: number;
  title: string;
  rows: ChartTooltipRow[];
  /** fila de cierre (p. ej. el total de una barra apilada) */
  footer?: { label: string; value: string };
  className?: string;
}

/**
 * Lectura flotante de la posición activa: una sola caja con todas las series.
 * Manda la cifra (fuerte, a la derecha); el nombre de la serie es secundario.
 *
 * Es un refuerzo visual: no recibe el puntero y queda fuera del árbol de
 * accesibilidad, porque la misma lectura está en la etiqueta de la zona activa
 * y en la tabla de datos.
 */
export function ChartTooltip({ x, top, offset, containerWidth, title, rows, footer, className }: ChartTooltipProps) {
  const [ref, size] = useElementSize<HTMLDivElement>("border");
  const width = size?.width ?? 0;

  // A la derecha de la marca; si no cabe, a la izquierda; si tampoco, centrado y sujeto al borde.
  let left = x + offset;
  if (left + width > containerWidth) left = x - offset - width;
  if (left < 0) left = Math.min(Math.max(x - width / 2, 0), Math.max(0, containerWidth - width));

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn("chart-tooltip", className)}
      style={{
        transform: `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`,
        visibility: size ? "visible" : "hidden",
      }}
    >
      <p className="mb-1.5 truncate text-fg-2">{title}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            {row.mark ? <ChartSwatch mark={row.mark} /> : <span />}
            <dt className="truncate text-fg-2">{row.label}</dt>
            <dd className="tabular pl-3 text-right font-mono font-medium text-fg">{row.value}</dd>
          </div>
        ))}
      </dl>
      {footer && (
        <p className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-line pt-1.5">
          <span className="text-fg-2">{footer.label}</span>
          <span className="tabular font-mono font-medium text-fg">{footer.value}</span>
        </p>
      )}
    </div>
  );
}
