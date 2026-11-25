import Link from "next/link";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, Circle, Info } from "lucide-react";
import { formatPercent } from "@/lib/format";
import type { AttentionItem } from "@/server/queries/dashboard";

/** Variación porcentual entre dos periodos para un KPI (undefined si no hay base). */
export function pctDelta(current: number, previous: number, goodWhenUp: boolean) {
  if (previous === 0) return undefined;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const direction = pct > 0.5 ? ("up" as const) : pct < -0.5 ? ("down" as const) : ("flat" as const);
  const sentiment = direction === "flat" ? ("neutral" as const) : (direction === "up") === goodWhenUp ? ("positive" as const) : ("negative" as const);
  return { text: `${pct > 0 ? "+" : ""}${formatPercent(pct)}`, direction, sentiment };
}

const ICON = { danger: AlertCircle, warn: AlertTriangle, neutral: Info };
const INK = { danger: "text-danger", warn: "text-warn", neutral: "text-fg-3" };

/** Lista priorizada de cosas que requieren atención; cada una enlaza a donde se resuelve. */
export function AttentionList({ items, max = 8 }: { items: AttentionItem[]; max?: number }) {
  if (items.length === 0) {
    return (
      <p className="flex items-start gap-2.5 py-2 text-sm text-fg-2">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden="true" />
        Todo en orden: no hay pedidos atrasados, incidencias ni avisos de stock.
      </p>
    );
  }
  const order = { danger: 0, warn: 1, neutral: 2 };
  const sorted = [...items].sort((a, b) => order[a.tone] - order[b.tone]);
  return (
    <ul className="-mx-2 flex flex-col">
      {sorted.slice(0, max).map((item) => {
        const Icon = ICON[item.tone];
        return (
          <li key={item.key}>
            <Link href={item.href} className="flex min-h-10 items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors hover:bg-hover active:bg-active pointer-coarse:min-h-11">
              <Icon className={`size-4 shrink-0 ${INK[item.tone]}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">{item.text}</span>
              <ChevronRight className="size-4 shrink-0 text-fg-3" aria-hidden="true" />
            </Link>
          </li>
        );
      })}
      {sorted.length > max ? <li className="px-2 pt-1 text-[0.8125rem] text-fg-3">y {sorted.length - max} más</li> : null}
    </ul>
  );
}

/** Lista de primeros pasos para una sub-empresa recién creada. */
export function Checklist({ steps }: { steps: Array<{ label: string; description: string; href: string; done: boolean }> }) {
  return (
    <ol className="flex flex-col divide-y divide-line">
      {steps.map((step) => (
        <li key={step.href}>
          <Link href={step.href} className="flex items-center gap-3.5 py-3.5 transition-colors hover:bg-elevated active:bg-hover">
            {step.done ? <CheckCircle2 className="size-5 shrink-0 text-ok" aria-hidden="true" /> : <Circle className="size-5 shrink-0 text-fg-3" aria-hidden="true" />}
            <span className="min-w-0 flex-1">
              <span className={`block text-sm font-medium ${step.done ? "text-fg-2 line-through" : "text-fg"}`}>{step.label}</span>
              <span className="block text-[0.8125rem] text-fg-3">{step.description}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-fg-3" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ol>
  );
}
