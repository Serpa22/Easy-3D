"use client";

import { useId, useState, type ReactNode } from "react";
import { Table2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ChartEmpty } from "./chart-empty";
import { useElementSize } from "./use-element-size";

/** Gemelo accesible del gráfico: mismas cifras, en una tabla real. */
export interface ChartTableData {
  caption: string;
  /** cabeceras; la primera columna es la cabecera de fila */
  columns: string[];
  rows: string[][];
}

export interface ChartFrameProps {
  /** título visible; si la tarjeta ya lo pone, usa `ariaLabel` */
  title?: string;
  description?: string;
  ariaLabel?: string;
  legend?: ReactNode;
  /** alto total del gráfico, eje X incluido */
  height: number;
  isEmpty?: boolean;
  emptyMessage?: string;
  table?: ChartTableData;
  className?: string;
  /** recibe el ancho disponible en px; `null` en el servidor y antes de medir */
  children: (width: number | null) => ReactNode;
}

/**
 * Marco común: título, leyenda, ancho responsive (ResizeObserver), estado vacío
 * y el botón que cambia el gráfico por su tabla de datos.
 */
export function ChartFrame({
  title,
  description,
  ariaLabel,
  legend,
  height,
  isEmpty = false,
  emptyMessage,
  table,
  className,
  children,
}: ChartFrameProps) {
  const titleId = useId();
  const [showTable, setShowTable] = useState(false);
  const [bodyRef, size] = useElementSize<HTMLDivElement>();
  const canToggle = Boolean(table) && !isEmpty;
  const hasHead = Boolean(title || description || legend || canToggle);

  return (
    <figure
      className={cn("chart", className)}
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : ariaLabel}
    >
      {hasHead && (
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            {(title || description) && (
              <div className="min-w-0">
                {title && (
                  <p id={titleId} className="text-sm font-medium text-fg">
                    {title}
                  </p>
                )}
                {description && <p className="text-pretty text-xs text-fg-3">{description}</p>}
              </div>
            )}
            {!isEmpty && legend}
          </div>
          {canToggle && (
            <button
              type="button"
              className="chart-toggle -mr-1.5 -mt-1.5"
              aria-pressed={showTable}
              aria-label="Ver los datos en tabla"
              title="Ver los datos en tabla"
              onClick={() => setShowTable((v) => !v)}
            >
              <Table2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
            </button>
          )}
        </div>
      )}

      {isEmpty ? (
        <ChartEmpty message={emptyMessage} height={height} />
      ) : showTable && table ? (
        <div className="scroll-x" style={{ minHeight: height }}>
          <ChartTable data={table} />
        </div>
      ) : (
        <div ref={bodyRef} className="chart-body" style={{ height }}>
          {children(size ? size.width : null)}
        </div>
      )}
    </figure>
  );
}

function ChartTable({ data }: { data: ChartTableData }) {
  return (
    <table className="chart-table">
      <caption>{data.caption}</caption>
      <thead>
        <tr>
          {data.columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) =>
              c === 0 ? (
                <th key={c} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={c}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
