"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { Check, Copy, Moon, Printer, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import type { Theme } from "@/lib/theme";
import { useNow } from "@/lib/use-now";
import { setThemeAction } from "@/server/actions/theme";
import { buttonClass } from "./button";

/* El tema vive en <html data-theme>: se observa ese atributo como fuente de verdad. */
function subscribeTheme(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const readTheme = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

/** Alterna tema oscuro / claro: cambia al instante y guarda la preferencia en una cookie. */
export function ThemeToggle({ className, showLabel }: { className?: string; showLabel?: boolean }) {
  const theme = useSyncExternalStore<Theme | null>(subscribeTheme, readTheme, () => null);
  const [, startTransition] = useTransition();
  const next: Theme = theme === "light" ? "dark" : "light";
  const label = next === "light" ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        startTransition(() => setThemeAction(next));
      }}
      className={cn(buttonClass({ variant: "ghost" }), !showLabel && "w-10 px-0 pointer-coarse:w-11", className)}
    >
      {theme === "light" ? <Moon className="size-[1.125rem]" aria-hidden="true" /> : <Sun className="size-[1.125rem]" aria-hidden="true" />}
      {showLabel ? <span>{next === "light" ? "Tema claro" : "Tema oscuro"}</span> : null}
    </button>
  );
}

/** Abre el diálogo de impresión del navegador (desde ahí también se guarda en PDF). */
export function PrintButton({ label = "Imprimir o guardar PDF", className }: { label?: string; className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={cn(buttonClass({ variant: "primary" }), className)}>
      <Printer className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}

/** Copia un texto al portapapeles y lo confirma. */
export function CopyButton({ value, label = "Copiar", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={copied ? "Copiado" : label}
      title={copied ? "Copiado" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          /* portapapeles no disponible */
        }
      }}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-fg-3 transition-colors hover:bg-hover hover:text-fg active:bg-active pointer-coarse:size-11",
        className,
      )}
    >
      {copied ? <Check className="size-4 text-ok" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
    </button>
  );
}

/**
 * Tiempo relativo («hace 5 min») que se actualiza solo. Se pinta únicamente en
 * el cliente para no provocar desajustes de hidratación.
 */
export function RelativeTime({ value, className, fallback = "—" }: { value: string | Date | null | undefined; className?: string; fallback?: string }) {
  const now = useNow();
  if (!value) return <span className={className}>{fallback}</span>;
  return (
    <time dateTime={typeof value === "string" ? value : value.toISOString()} className={className} suppressHydrationWarning>
      {now ? formatRelative(value, new Date(now)) : "…"}
    </time>
  );
}
