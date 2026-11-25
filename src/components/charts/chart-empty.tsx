import { ChartNoAxesColumn } from "lucide-react";
import { cn } from "@/lib/cn";

export const DEFAULT_EMPTY_MESSAGE = "Sin datos en este periodo";

/** Estado vacío de un gráfico: ocupa el mismo alto que ocuparía el gráfico. */
export function ChartEmpty({
  message = DEFAULT_EMPTY_MESSAGE,
  height,
  className,
}: {
  message?: string;
  height?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-2 px-4 py-6 text-center text-sm text-fg-3", className)}
      style={height ? { minHeight: height } : undefined}
    >
      <ChartNoAxesColumn aria-hidden="true" className="size-5" strokeWidth={1.5} />
      <p className="text-pretty">{message}</p>
    </div>
  );
}
