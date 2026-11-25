/** Navegación por URL: pestañas, paginación, selector de mes y barra de filtros. */
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { addMonths } from "@/lib/dates";
import { formatMonth } from "@/lib/format";

export type SearchParams = Record<string, string | string[] | undefined>;

/** Primer valor de un parámetro de búsqueda. */
export function param(searchParams: SearchParams, key: string): string | undefined {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Construye una URL conservando los parámetros actuales y aplicando cambios (null = quitar). */
export function hrefWith(basePath: string, searchParams: SearchParams, patch: Record<string, string | number | null | undefined>): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v !== undefined && v !== "") next.set(key, v);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") next.delete(key);
    else next.set(key, String(value));
  }
  const query = next.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export interface TabItem {
  href: string;
  label: string;
  count?: number;
  /** Marca la pestaña activa. */
  current?: boolean;
}

/** Pestañas basadas en enlaces (rutas o parámetros de URL). */
export function TabsNav({ items, label, className }: { items: TabItem[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn("scroll-x -mx-4 border-b border-line px-4 sm:mx-0 sm:px-0", className)}>
      <ul className="flex min-w-max gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              scroll={false}
              className={cn(
                "relative flex h-10 items-center gap-2 whitespace-nowrap px-3 text-sm transition-colors pointer-coarse:h-11",
                item.current
                  ? "font-medium text-fg after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-fg"
                  : "text-fg-2 hover:text-fg active:text-fg-3",
              )}
            >
              {item.label}
              {item.count !== undefined ? (
                <span className={cn("rounded-sm px-1.5 py-0.5 font-mono text-[0.6875rem] tabular", item.current ? "bg-primary text-primary-fg" : "bg-hover text-fg-2")}>
                  {item.count}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const stepClass =
  "inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-md border border-control px-2.5 text-sm text-fg transition-colors hover:bg-hover active:bg-active aria-disabled:pointer-events-none aria-disabled:opacity-40 pointer-coarse:h-11 pointer-coarse:min-w-11";

/** Paginación «anterior / siguiente» sobre el parámetro `pag`. */
export function Pagination({ page, pageCount, total, basePath, searchParams, className }: { page: number; pageCount: number; total?: number; basePath: string; searchParams: SearchParams; className?: string }) {
  if (pageCount <= 1) return null;
  const prev = page > 1 ? hrefWith(basePath, searchParams, { pag: page - 1 === 1 ? null : page - 1 }) : undefined;
  const next = page < pageCount ? hrefWith(basePath, searchParams, { pag: page + 1 }) : undefined;
  return (
    <nav aria-label="Paginación" className={cn("flex items-center justify-between gap-3 text-sm text-fg-2", className)}>
      <span className="tabular">
        Página {page} de {pageCount}
        {total !== undefined ? <span className="text-fg-3"> · {total} en total</span> : null}
      </span>
      <div className="flex gap-2">
        <Link href={prev ?? "#"} aria-disabled={!prev} tabIndex={prev ? undefined : -1} className={stepClass}>
          <ChevronLeft className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Anterior</span>
        </Link>
        <Link href={next ?? "#"} aria-disabled={!next} tabIndex={next ? undefined : -1} className={stepClass}>
          <span className="hidden sm:inline">Siguiente</span>
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </nav>
  );
}

/** Selector de mes con flechas, sobre un parámetro de URL ('YYYY-MM'). */
export function MonthNav({
  month,
  basePath,
  searchParams,
  paramName = "mes",
  maxMonth,
  className,
}: {
  month: string;
  basePath: string;
  searchParams: SearchParams;
  paramName?: string;
  /** No deja avanzar más allá de este mes (normalmente el actual). */
  maxMonth?: string;
  className?: string;
}) {
  const prev = hrefWith(basePath, searchParams, { [paramName]: addMonths(month, -1), pag: null });
  const canNext = !maxMonth || month < maxMonth;
  const nextMonth = addMonths(month, 1);
  const next = hrefWith(basePath, searchParams, { [paramName]: maxMonth && nextMonth === maxMonth ? null : nextMonth, pag: null });
  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <Link href={prev} aria-label="Mes anterior" scroll={false} className={stepClass}>
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Link>
      <span className="inline-block min-w-36 text-center text-sm font-medium text-fg first-letter:uppercase">{formatMonth(month)}</span>
      <Link href={canNext ? next : "#"} aria-label="Mes siguiente" aria-disabled={!canNext} tabIndex={canNext ? undefined : -1} scroll={false} className={stepClass}>
        <ChevronRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

/** Fila de filtros sobre una tabla (buscador, selects, pestañas…). */
export function FilterBar({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center", className)}>{children}</div>;
}

/** Grupo de «chips» de filtro basados en enlaces. */
export function FilterChips({ items, label, className }: { items: TabItem[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn("scroll-x -mx-4 px-4 sm:mx-0 sm:px-0", className)}>
      <ul className="flex min-w-max gap-1.5">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              scroll={false}
              aria-current={item.current ? "true" : undefined}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-sm transition-colors pointer-coarse:h-11",
                item.current ? "border-primary bg-primary font-medium text-primary-fg" : "border-control text-fg-2 hover:bg-hover hover:text-fg active:bg-active",
              )}
            >
              {item.label}
              {item.count !== undefined ? <span className="font-mono text-xs tabular opacity-70">{item.count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
