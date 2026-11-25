/**
 * Gráficos sencillos sin ejes (compatibles con Server Components):
 * BarList (ranking horizontal), StackedBar (composición) y Sparkline.
 */
import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import { formatValue, type ChartFormat } from "./format";

const HATCH = "repeating-linear-gradient(45deg, var(--chart-2) 0 2px, var(--chart-texture-base) 2px 5px)";

export interface BarListItem {
  label: string;
  value: number;
  /** Texto secundario bajo la etiqueta. */
  hint?: string;
  href?: string;
}

/**
 * Ranking horizontal: etiqueta, barra proporcional y valor. Sustituye a los
 * gráficos de tarta («gastos por categoría», «consumo por máquina»…).
 */
export function BarList({
  items,
  format = "number",
  showShare,
  emptyMessage = "Sin datos en este periodo",
  className,
}: {
  items: BarListItem[];
  format?: ChartFormat;
  /** Añade el porcentaje sobre el total. */
  showShare?: boolean;
  emptyMessage?: string;
  className?: string;
}) {
  const visible = items.filter((i) => Number.isFinite(i.value) && i.value !== 0);
  if (visible.length === 0) return <p className={cn("py-6 text-center text-sm text-fg-3", className)}>{emptyMessage}</p>;
  const max = Math.max(...visible.map((i) => Math.abs(i.value)));
  const total = visible.reduce((acc, i) => acc + Math.abs(i.value), 0);
  return (
    <ul className={cn("flex flex-col gap-3", className)}>
      {visible.map((item) => {
        const pct = max > 0 ? (Math.abs(item.value) / max) * 100 : 0;
        const label = (
          <span className="min-w-0 truncate text-sm text-fg">
            {item.label}
            {item.hint ? <span className="ml-2 text-fg-3">{item.hint}</span> : null}
          </span>
        );
        return (
          <li key={item.label} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              {item.href ? (
                <Link href={item.href} className="min-w-0 truncate underline-offset-4 hover:underline active:text-fg-2">
                  {label}
                </Link>
              ) : (
                label
              )}
              <span className="shrink-0 whitespace-nowrap font-mono text-sm text-fg tabular">
                {formatValue(item.value, format)}
                {showShare && total > 0 ? <span className="ml-2 text-fg-3">{formatPercent((Math.abs(item.value) / total) * 100)}</span> : null}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-xl bg-active" aria-hidden="true">
              <div className="h-full rounded-xl" style={{ width: `${Math.max(pct, 1.5)}%`, background: "var(--chart-1)" }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export interface StackedSegment {
  label: string;
  value: number;
  /** Solo para marcar estado (error, aviso). */
  tone?: "ok" | "warn" | "danger";
}

const SEGMENT_FILLS = ["var(--chart-1)", HATCH, "transparent", "var(--chart-3)"];

function segmentStyle(index: number, tone?: StackedSegment["tone"]): React.CSSProperties {
  if (tone) return { background: `var(--chart-${tone})` };
  const fill = SEGMENT_FILLS[index % SEGMENT_FILLS.length];
  return fill === "transparent" ? { background: "transparent", boxShadow: "inset 0 0 0 1.5px var(--chart-2)" } : { background: fill };
}

/** Barra de composición con leyenda (p. ej. máquinas trabajando / en reposo / sin conexión). */
export function StackedBar({ segments, format = "count", className, ariaLabel }: { segments: StackedSegment[]; format?: ChartFormat; className?: string; ariaLabel?: string }) {
  const total = segments.reduce((acc, s) => acc + Math.max(0, s.value), 0);
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        role="img"
        aria-label={ariaLabel ?? segments.map((s) => `${s.label}: ${formatValue(s.value, format)}`).join(", ")}
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-xl"
      >
        {total === 0 ? (
          <div className="h-full w-full rounded-xl bg-active" />
        ) : (
          segments.map((s, i) =>
            s.value > 0 ? <div key={s.label} className="h-full min-w-1.5 rounded-[3px]" style={{ ...segmentStyle(i, s.tone), flexGrow: s.value, flexBasis: 0 }} /> : null,
          )
        )}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[0.8125rem]">
        {segments.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={segmentStyle(i, s.tone)} />
            <span className="text-fg-2">{s.label}</span>
            <span className="font-mono text-fg tabular">{formatValue(s.value, format)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tendencia en miniatura, sin ejes. */
export function Sparkline({ values, width = 96, height = 28, label, className }: { values: number[]; width?: number; height?: number; label: string; className?: string }) {
  const clean = values.map((v) => (Number.isFinite(v) ? v : 0));
  if (clean.length < 2) return <span className={cn("inline-block", className)} style={{ width, height }} aria-hidden="true" />;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const pad = 3;
  const points = clean.map((v, i) => {
    const x = pad + (i / (clean.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const [lastX, lastY] = points[points.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className={cn("shrink-0 overflow-visible", className)}>
      <polyline points={points.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--chart-2)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill="var(--chart-1)" stroke="var(--chart-surface)" strokeWidth="1.5" />
    </svg>
  );
}
