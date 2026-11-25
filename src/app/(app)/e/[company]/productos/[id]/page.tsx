import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Copy, Pencil, Power, Trash2 } from "lucide-react";
import { z } from "zod";
import { BarChart } from "@/components/charts/bar-chart";
import { CostPanel } from "@/components/products/cost-panel";
import { ActionButton, ActionsMenu, FormDialogButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader, Stat, StatGrid } from "@/components/ui/display";
import { Field, NumberInput } from "@/components/ui/form";
import { suggestedPriceCents } from "@/lib/costing";
import { addDays, lastMonths, monthOf, todayISO } from "@/lib/dates";
import { PRINT_JOB_STATUS_LABELS } from "@/lib/domain";
import { formatDateShort, formatDuration, formatMoney, formatMonth, formatMonthShort, formatPercent, formatQty } from "@/lib/format";
import { productUnitCost } from "@/lib/product-cost";
import { adjustProductStockAction, deleteProductAction, duplicateProductAction, setProductActiveAction } from "@/server/actions/products";
import { requireCompany } from "@/server/context";
import { getProduct } from "@/server/queries/products";

export const metadata: Metadata = { title: "Producto" };

export default async function ProductPage({ params }: { params: Promise<{ company: string; id: string }> }) {
  const { company: slugParam, id } = await params;
  const { company, db, org } = await requireCompany(slugParam);
  if (!z.uuid().safeParse(id).success) notFound();
  const today = todayISO(org.timeZone);
  const months = lastMonths(12, monthOf(today));
  const data = await getProduct(db, company.id, id, { d30: addDays(today, -30), d90: addDays(today, -90), d365: addDays(today, -365) }, months);
  if (!data) notFound();
  const { product: p, material, machine, sales, monthly, jobs } = data;
  const slug = company.slug;
  const base = `/e/${slug}`;
  const cost = productUnitCost(p, material, machine, company);
  const suggested = suggestedPriceCents(cost.totalCents, company.targetMarginPct, company.vatRatePct);

  return (
    <>
      <PageHeader
        back={{ href: `${base}/productos`, label: "Productos" }}
        eyebrow={[p.sku, p.category].filter(Boolean).join(" · ") || undefined}
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base text-fg tabular">{formatMoney(p.priceCents)}</span>
            <span className="text-fg-3">IVA incluido</span>
            {!p.active ? <Badge>Inactivo</Badge> : null}
          </span>
        }
        actions={
          <>
            <Button href={`${base}/productos/${p.id}/editar`} icon={<Pencil />} variant="primary">
              Editar
            </Button>
            <ActionsMenu
              label="Más acciones"
              variant="secondary"
              items={[
                { type: "action", label: "Duplicar", icon: <Copy />, action: duplicateProductAction.bind(null, slug, p.id) },
                { type: "action", label: p.active ? "Desactivar" : "Activar", icon: <Power />, action: setProductActiveAction.bind(null, slug, p.id, !p.active) },
                { type: "separator" },
                { type: "confirm", label: "Eliminar", icon: <Trash2 />, danger: true, title: `¿Eliminar «${p.name}»?`, description: "Los pedidos e impresiones que lo usaban conservan su texto, pero dejan de estar enlazados al producto.", action: deleteProductAction.bind(null, slug, p.id) },
              ]}
            />
          </>
        }
      />

      <StatGrid cols={4}>
        <Stat
          label="Stock"
          value={`${p.stockQty} ud`}
          hint={p.stockQty <= 0 ? <Badge tone="danger">Agotado</Badge> : p.lowStockThreshold > 0 && p.stockQty <= p.lowStockThreshold ? <Badge tone="warn">Stock bajo</Badge> : `Aviso a ${p.lowStockThreshold} ud`}
        />
        <Stat label="Vendidos 30 días" value={sales.u30} hint={`${sales.u90} en 90 días`} />
        <Stat label="Vendidos 12 meses" value={sales.u365} hint={formatMoney(sales.r365)} />
        <Stat label="Precio recomendado" value={cost.totalCents > 0 ? formatMoney(suggested) : "—"} hint={`Para un margen del ${formatPercent(company.targetMarginPct)}`} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader title="Unidades vendidas" description="Últimos 12 meses" />
            <CardBody>
              <BarChart data={monthly.map((m) => ({ label: formatMonthShort(m.month), fullLabel: formatMonth(m.month), values: { units: m.units } }))} series={[{ key: "units", label: "Unidades" }]} format="count" height={200} ariaLabel={`Unidades vendidas de ${p.name}`} categoryLabel="Mes" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Últimas impresiones" />
            <CardBody className="pt-3">
              {jobs.length === 0 ? (
                <p className="text-sm text-fg-2">Aún no se ha impreso este producto. Al apuntar o detectar una impresión puedes asociarla al producto para sumar piezas al stock.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {jobs.map((j) => (
                    <li key={j.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
                      <span className="min-w-0 truncate">{j.name}</span>
                      <span className="text-fg-3">
                        {j.machineName ?? "Sin máquina"} · {formatDateShort(j.startedAt, org.timeZone)} · {j.piecesProduced} ud{j.piecesFailed > 0 ? ` (${j.piecesFailed} fallidas)` : ""} · {PRINT_JOB_STATUS_LABELS[j.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Coste y margen" />
            <CardBody>
              <CostPanel cost={cost} priceCents={p.priceCents} vatRatePct={company.vatRatePct} targetMarginPct={company.targetMarginPct} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Receta" />
            <CardBody>
              <DescriptionList
                cols={1}
                items={[
                  { term: "Material", value: material ? <Link href={`${base}/materiales/${material.id}`} className="underline underline-offset-4 hover:text-fg-2">{material.name} · {formatQty(p.materialQty, material.unit)}</Link> : "—" },
                  { term: "Impresión", value: p.printMinutes > 0 ? formatDuration(p.printMinutes * 60) : "—" },
                  { term: "Mano de obra", value: p.laborMinutes > 0 ? formatDuration(p.laborMinutes * 60) : "—" },
                  { term: "Máquina habitual", value: machine ? <Link href={`${base}/maquinas/${machine.id}`} className="underline underline-offset-4 hover:text-fg-2">{machine.name}</Link> : "—" },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Ajustar stock" description="Suma unidades fabricadas o resta las que salgan sin pedido." />
            <CardBody className="flex flex-wrap gap-2">
              <FormDialogButton label="Sumar o restar unidades" title="Ajustar stock" description={`Stock actual: ${p.stockQty} ud`} action={adjustProductStockAction.bind(null, slug)} submitLabel="Ajustar">
                <input type="hidden" name="productId" value={p.id} />
                <Field label="Unidades" name="delta" required hint="Positivo para sumar, negativo para restar. Ej.: 12 o -3">
                  <NumberInput unit="ud" autoFocus />
                </Field>
              </FormDialogButton>
              {p.active ? null : <ActionButton action={setProductActiveAction.bind(null, slug, p.id, true)}>Activar producto</ActionButton>}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
