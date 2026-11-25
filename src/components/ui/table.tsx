/** Tablas de datos (compatibles con Server Components). */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Align = "left" | "right" | "center";
const ALIGN: Record<Align, string> = { left: "text-left", right: "text-right", center: "text-center" };
const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };

/** Tabla dentro de su propio contenedor con scroll horizontal. */
export function Table({ className, children, ...props }: ComponentProps<"table">) {
  return (
    <div className="scroll-x relative rounded-lg border border-line bg-surface">
      <table className={cn("w-full border-collapse text-sm", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function THead(props: ComponentProps<"thead">) {
  return <thead {...props} />;
}
export function TBody(props: ComponentProps<"tbody">) {
  return <tbody {...props} />;
}
export function TR({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("border-b border-line transition-colors last:border-b-0 [tbody>&]:hover:bg-elevated", className)} {...props} />;
}
export function TH({ align = "left", hideBelow, className, ...props }: ComponentProps<"th"> & { align?: Align; hideBelow?: keyof typeof HIDE }) {
  return (
    <th
      scope="col"
      className={cn(
        "h-10 whitespace-nowrap border-b border-line px-4 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-3",
        ALIGN[align],
        hideBelow && HIDE[hideBelow],
        className,
      )}
      {...props}
    />
  );
}
export function TD({ align = "left", hideBelow, numeric, className, ...props }: ComponentProps<"td"> & { align?: Align; hideBelow?: keyof typeof HIDE; numeric?: boolean }) {
  return (
    <td
      className={cn(
        "px-4 py-3 align-middle text-fg",
        ALIGN[numeric ? "right" : align],
        numeric && "whitespace-nowrap font-mono tabular",
        hideBelow && HIDE[hideBelow],
        className,
      )}
      {...props}
    />
  );
}

export interface Column {
  key: string;
  header: ReactNode;
  align?: Align;
  /** Cifras: alineadas a la derecha, monoespaciadas. */
  numeric?: boolean;
  /** Oculta la columna por debajo de ese ancho. */
  hideBelow?: keyof typeof HIDE;
  className?: string;
}

export interface Row {
  key: string;
  /** Una celda por columna, en el mismo orden. */
  cells: ReactNode[];
  /** Si se indica, la primera celda enlaza al detalle. */
  href?: string;
}

/**
 * Tabla a partir de columnas y filas ya pintadas (sin funciones: sirve desde
 * Server Components). `empty` se muestra cuando no hay filas.
 */
export function DataTable({ columns, rows, empty, caption, className }: { columns: Column[]; rows: Row[]; empty?: ReactNode; caption?: string; className?: string }) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <Table className={className}>
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      <THead>
        <tr>
          {columns.map((col) => (
            <TH key={col.key} align={col.numeric ? "right" : col.align} hideBelow={col.hideBelow} className={col.className}>
              {col.header}
            </TH>
          ))}
        </tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR key={row.key}>
            {columns.map((col, i) => (
              <TD key={col.key} align={col.align} numeric={col.numeric} hideBelow={col.hideBelow} className={col.className}>
                {i === 0 && row.href ? (
                  <Link href={row.href} className="font-medium text-fg underline-offset-4 hover:underline active:text-fg-2">
                    {row.cells[i]}
                  </Link>
                ) : (
                  row.cells[i]
                )}
              </TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
