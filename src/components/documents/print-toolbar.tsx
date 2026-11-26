import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PrintButton } from "@/components/ui/client-bits";

/** Barra superior de las páginas de impresión (no sale en el papel). */
export function PrintToolbar({ backHref, backLabel, hint }: { backHref: string; backLabel: string; hint?: string }) {
  return (
    <div className="no-print mx-auto mb-4 flex w-full max-w-[210mm] flex-wrap items-center justify-between gap-3">
      <Button href={backHref} variant="ghost" icon={<ArrowLeft />}>
        {backLabel}
      </Button>
      <div className="flex flex-wrap items-center gap-3">
        {hint ? <p className="text-[0.8125rem] text-fg-3">{hint}</p> : null}
        <PrintButton />
      </div>
    </div>
  );
}
