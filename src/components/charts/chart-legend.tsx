import { cn } from "@/lib/cn";
import type { ChartMark } from "./types";

export interface ChartLegendItem {
  label: string;
  mark: ChartMark;
  /** cifra opcional junto al nombre (p. ej. en barras de composición) */
  value?: string;
}

/**
 * Muestra de una codificación: refleja la marca (rectángulo para barras y
 * áreas, trazo para líneas) con su textura o su patrón de trazo, de modo que
 * la clave se lee aunque dos grises se confundan.
 */
export function ChartSwatch({ mark, className }: { mark: ChartMark; className?: string }) {
  if (mark.startsWith("line-")) {
    const index = mark === "line-solid" ? 1 : mark === "line-dashed" ? 2 : 3;
    return (
      <svg
        aria-hidden="true"
        width="22"
        height="12"
        viewBox="0 0 22 12"
        className={cn("shrink-0", className)}
        focusable="false"
      >
        <line x1="2" y1="6" x2="20" y2="6" className={`chart-line chart-line-${index}`} />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      className={cn("shrink-0", className)}
      focusable="false"
    >
      {mark === "hatch" ? (
        <>
          <rect width="12" height="12" rx="2.5" className="chart-texture-base" />
          <path
            d="M1,6.5 L6.5,1 M1.5,11 L11,1.5 M6,11.5 L11.5,6"
            className="chart-texture-ink"
            strokeWidth="2"
            fill="none"
          />
        </>
      ) : mark === "outline" ? (
        <rect x="0.75" y="0.75" width="10.5" height="10.5" rx="2" className="chart-mark-outline" />
      ) : (
        <rect width="12" height="12" rx="2.5" className={`chart-mark-${mark}`} />
      )}
    </svg>
  );
}

/**
 * Leyenda. Obligatoria con dos o más series: es el canal fiable de identidad.
 * Con una sola serie no se pinta (el título ya dice qué se representa).
 */
export function ChartLegend({ items, className }: { items: ChartLegendItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Leyenda" className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-2", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex min-w-0 items-center gap-2">
          <ChartSwatch mark={item.mark} />
          <span className="truncate">{item.label}</span>
          {item.value !== undefined && <span className="tabular font-mono text-fg">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}
