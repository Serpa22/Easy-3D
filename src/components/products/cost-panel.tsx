import type { CostBreakdown } from "@/lib/costing";
import { marginOf } from "@/lib/costing";
import { formatMoney, formatPercent } from "@/lib/format";
import { COST_PARTS } from "@/lib/product-cost";

/** Desglose del coste unitario y margen frente a un precio (compatible con servidor y cliente). */
export function CostPanel({ cost, priceCents, vatRatePct, targetMarginPct }: { cost: CostBreakdown; priceCents: number; vatRatePct: number; targetMarginPct: number }) {
  const margin = marginOf(priceCents, cost.totalCents, vatRatePct);
  const marginTone = margin.profitCents < 0 ? "text-danger" : margin.marginPct < targetMarginPct ? "text-warn" : "text-ok";
  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col gap-2 text-sm">
        {COST_PARTS.filter((p) => cost[p.key] > 0).map((p) => (
          <div key={p.key} className="flex items-center gap-3">
            <dt className="w-44 shrink-0 truncate text-fg-2">{p.label}</dt>
            <div className="h-1.5 flex-1 overflow-hidden rounded-xl bg-active" aria-hidden="true">
              <div className="h-full rounded-xl bg-fg" style={{ width: `${cost.totalCents > 0 ? Math.max(2, (cost[p.key] / cost.totalCents) * 100) : 0}%` }} />
            </div>
            <dd className="w-20 shrink-0 text-right font-mono tabular">{formatMoney(cost[p.key])}</dd>
          </div>
        ))}
        <div className="mt-1 flex items-baseline justify-between border-t border-line pt-3">
          <dt className="font-semibold">Coste por unidad</dt>
          <dd className="font-mono text-xl font-medium tabular">{formatMoney(cost.totalCents)}</dd>
        </div>
      </dl>
      <dl className="grid grid-cols-3 gap-3 rounded-md border border-line bg-bg p-3 text-sm">
        <div>
          <dt className="text-xs text-fg-3">Precio sin IVA</dt>
          <dd className="mt-0.5 font-mono tabular">{formatMoney(margin.netCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-3">Beneficio / ud</dt>
          <dd className={`mt-0.5 font-mono tabular ${margin.profitCents < 0 ? "text-danger" : ""}`}>{formatMoney(margin.profitCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-3">Margen</dt>
          <dd className={`mt-0.5 font-mono font-medium tabular ${marginTone}`}>{priceCents > 0 ? formatPercent(margin.marginPct) : "—"}</dd>
        </div>
      </dl>
    </div>
  );
}
