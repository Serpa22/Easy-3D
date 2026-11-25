import { cn } from "@/lib/cn";

/** Título y descripción de un gráfico (opcional: a menudo los pone la tarjeta). */
export function ChartHeading({
  id,
  title,
  description,
  className,
}: {
  id?: string;
  title?: string;
  description?: string;
  className?: string;
}) {
  if (!title && !description) return null;
  return (
    <div className={cn("min-w-0", className)}>
      {title && (
        <p id={id} className="text-sm font-medium text-fg">
          {title}
        </p>
      )}
      {description && <p className="text-pretty text-xs text-fg-3">{description}</p>}
    </div>
  );
}
