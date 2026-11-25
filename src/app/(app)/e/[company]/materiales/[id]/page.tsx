import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, Pencil, Scale, ShoppingCart, Trash, Trash2, Undo2 } from "lucide-react";
import { z } from "zod";
import { BarChart } from "@/components/charts/bar-chart";
import { AdjustFields, MaterialFields, PurchaseFields, Swatch, WasteFields } from "@/components/materials/material-fields";
import { ActionButton, ActionsMenu, FormDialogButton } from "@/components/ui/actions";
import { Alert, Badge, Card, CardBody, CardHeader, DescriptionList, EmptyState, PageHeader, Stat, StatGrid } from "@/components/ui/display";
import { ConfirmButton } from "@/components/ui/dialog";
import { DataTable } from "@/components/ui/table";
import { addDays, lastMonths, monthOf, todayISO } from "@/lib/dates";
import { MATERIAL_KIND_LABELS, MOVEMENT_TYPE_LABELS } from "@/lib/domain";
import { formatDateShort, formatMoney, formatMonth, formatMonthShort, formatNumber, formatQty } from "@/lib/format";
import { adjustMaterialAction, archiveMaterialAction, deleteMaterialAction, purchaseMaterialAction, revertMovementAction, saveMaterialAction, wasteMaterialAction } from "@/server/actions/materials";
import { requireCompany } from "@/server/context";
import { getMaterial } from "@/server/queries/materials";

export const metadata: Metadata = { title: "Material" };

export default async function MaterialPage({ params }: { params: Promise<{ company: string; id: string }> }) {
  const { company: slugParam, id } = await params;
  const { company, db, org } = await requireCompany(slugParam);
  if (!z.uuid().safeParse(id).success) notFound();
  const today = todayISO(org.timeZone);
  const months = lastMonths(12, monthOf(today));
  const data = await getMaterial(db, company.id, id, addDays(today, -30), months);
  if (!data) notFound();
  const { material: m, movements, used30, monthly, loadedIn, usedIn, movementCount } = data;
  const slug = company.slug;
  const base = `/e/${slug}`;
  const out = m.stockQty <= 0;
  // El stock es la suma exacta de los movimientos: en negativo, faltan compras por registrar.
  const negative = m.stockQty < 0;
  const low = !out && m.lowStockThreshold > 0 && m.stockQty < m.lowStockThreshold;
  const daysLeft = used30 > 0 ? Math.max(0, Math.round(m.stockQty / (used30 / 30))) : null;
  const perUnit = m.packSize > 0 ? m.packCostCents / m.packSize : 0;
  const unitPriceLabel = m.unit === "g" ? `${formatMoney(Math.round(perUnit * 1000))}/kg` : m.unit === "ml" ? `${formatMoney(Math.round(perUnit * 1000))}/L` : `${formatMoney(Math.round(perUnit))}/ud`;

  return (
    <>
      <PageHeader
        back={{ href: `${base}/materiales`, label: "Materiales" }}
        title={
          <span className="inline-flex items-center gap-3">
            <Swatch color={m.colorHex} className="size-6" />
            {m.name}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            {[MATERIAL_KIND_LABELS[m.kind], m.materialType, m.brand].filter(Boolean).join(" · ")}
            {m.archivedAt ? <Badge>Archivado</Badge> : negative ? <Badge tone="danger">Stock negativo</Badge> : out ? <Badge tone="danger">Agotado</Badge> : low ? <Badge tone="warn">Stock bajo</Badge> : null}
          </span>
        }
        actions={
          <>
            <FormDialogButton label="Registrar compra" icon={<ShoppingCart />} variant="primary" title={`Compra de ${m.name}`} action={purchaseMaterialAction.bind(null, slug)} submitLabel="Registrar compra">
              <PurchaseFields material={m} today={today} vat={company.vatRatePct} />
            </FormDialogButton>
            <ActionsMenu
              label="Más acciones"
              variant="secondary"
              items={[
                { type: "form", label: "Ajustar stock", icon: <Scale />, title: "Ajustar stock", action: adjustMaterialAction.bind(null, slug), submitLabel: "Ajustar", content: <AdjustFields material={m} /> },
                { type: "form", label: "Registrar merma", icon: <Trash />, title: "Registrar merma", action: wasteMaterialAction.bind(null, slug), submitLabel: "Registrar merma", content: <WasteFields material={m} /> },
                { type: "form", label: "Editar", icon: <Pencil />, title: "Editar material", dialogSize: "lg", action: saveMaterialAction.bind(null, slug), content: <MaterialFields material={m} /> },
                { type: "separator" },
                { type: "action", label: m.archivedAt ? "Recuperar" : "Archivar", icon: <Archive />, action: archiveMaterialAction.bind(null, slug, m.id, !m.archivedAt) },
              ]}
            />
          </>
        }
      />
      {negative ? (
        <Alert tone="warn" title="El stock está en negativo">
          Se ha consumido más {m.name} del que consta comprado. Registra la compra que falta o ajusta el stock al recuento real; mientras tanto el consumo se sigue apuntando para que las cuentas cuadren.
        </Alert>
      ) : null}
      <StatGrid cols={4}>
        <Stat label="Stock" value={formatQty(m.stockQty, m.unit)} hint={negative ? "Más consumo que compras registradas" : m.packSize > 0 ? `≈ ${formatNumber(m.stockQty / m.packSize, 1)} envases` : undefined} />
        <Stat label="Valor en stock" value={formatMoney(Math.round(perUnit * Math.max(0, m.stockQty)))} hint={unitPriceLabel} />
        <Stat label="Consumo 30 días" value={formatQty(used30, m.unit)} />
        <Stat label="Stock para" value={daysLeft === null ? "—" : `${daysLeft} días`} hint={daysLeft === null ? "Sin consumo reciente" : "Al ritmo actual"} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Consumo por mes" description="Últimos 12 meses (impresiones y mermas)" />
          <CardBody>
            <BarChart
              data={monthly.map((x) => ({ label: formatMonthShort(x.month), fullLabel: formatMonth(x.month), values: { used: x.used } }))}
              series={[{ key: "used", label: "Consumo" }]}
              format={m.unit === "g" ? "weight" : "number"}
              height={200}
              ariaLabel={`Consumo mensual de ${m.name}`}
              categoryLabel="Mes"
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Ficha" />
          <CardBody>
            <DescriptionList
              cols={1}
              items={[
                { term: "Envase", value: `${formatQty(m.packSize, m.unit)} · ${formatMoney(m.packCostCents)}` },
                { term: "Aviso de stock bajo", value: m.lowStockThreshold > 0 ? formatQty(m.lowStockThreshold, m.unit) : "Sin aviso" },
                { term: "Proveedor", value: m.supplier ?? "—" },
                { term: "Ubicación", value: m.location ?? "—" },
                {
                  term: "Cargado en",
                  value: loadedIn.length ? loadedIn.map((x, i) => (
                    <span key={x.id}>
                      {i > 0 ? ", " : ""}
                      <Link href={`${base}/maquinas/${x.id}`} className="underline underline-offset-4 hover:text-fg-2">{x.name}</Link>
                    </span>
                  )) : "Ninguna máquina",
                },
                {
                  term: "Usado en productos",
                  value: usedIn.length ? usedIn.slice(0, 6).map((x, i) => (
                    <span key={x.id}>
                      {i > 0 ? ", " : ""}
                      <Link href={`${base}/productos/${x.id}`} className="underline underline-offset-4 hover:text-fg-2">{x.name}</Link>
                    </span>
                  )) : "Ninguno",
                },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <DataTable
        caption="Movimientos del material"
        columns={[
          { key: "date", header: "Fecha" },
          { key: "type", header: "Tipo" },
          { key: "note", header: "Detalle", hideBelow: "sm" },
          { key: "qty", header: "Cantidad", numeric: true },
          { key: "cost", header: "Coste", numeric: true, hideBelow: "md" },
          { key: "undo", header: <span className="sr-only">Deshacer</span>, align: "right", className: "w-12 px-1" },
        ]}
        rows={movements.map(({ movement: mv, jobName }) => ({
          key: mv.id,
          cells: [
            <span key="d" className="whitespace-nowrap text-fg-2">{formatDateShort(mv.date)}</span>,
            <Badge key="t" tone={mv.type === "purchase" ? "solid" : mv.type === "waste" ? "warn" : "outline"}>{MOVEMENT_TYPE_LABELS[mv.type]}</Badge>,
            <span key="n" className="block max-w-xs truncate text-fg-2">{jobName ? `Impresión: ${jobName}` : (mv.note ?? "—")}</span>,
            <span key="q">{mv.qty > 0 ? "+" : "−"}{formatQty(Math.abs(mv.qty), m.unit)}</span>,
            mv.totalCostCents ? formatMoney(mv.totalCostCents) : "—",
            mv.printJobId ? null : (
              <ActionsMenu
                key="u"
                size="sm"
                label="Acciones del movimiento"
                items={[{ type: "confirm", label: "Deshacer movimiento", icon: <Undo2 />, danger: true, title: "¿Deshacer este movimiento?", description: "El stock volverá a como estaba antes y, si era una compra, se eliminará su gasto en Finanzas.", confirmLabel: "Deshacer", action: revertMovementAction.bind(null, slug, mv.id) }]}
              />
            ),
          ],
        }))}
        empty={<EmptyState title="Sin movimientos todavía" description="Las compras, los consumos de las impresiones, los ajustes y las mermas aparecerán aquí." />}
      />

      {movementCount === 0 ? (
        <ConfirmButton action={deleteMaterialAction.bind(null, slug, m.id)} title={`¿Eliminar ${m.name}?`} description="No tiene movimientos, así que se puede eliminar del todo." icon={<Trash2 />} variant="ghost" className="self-start text-danger">
          Eliminar material
        </ConfirmButton>
      ) : !m.archivedAt ? (
        <ActionButton action={archiveMaterialAction.bind(null, slug, m.id, true)} icon={<Archive />} variant="ghost" className="self-start">
          Archivar material
        </ActionButton>
      ) : null}
    </>
  );
}
