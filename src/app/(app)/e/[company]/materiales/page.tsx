import type { Metadata } from "next";
import { Archive, Cylinder, Eye, Pencil, Plus, Scale, ShoppingCart, Trash } from "lucide-react";
import { AdjustFields, MaterialFields, PurchaseFields, Swatch, WasteFields } from "@/components/materials/material-fields";
import { ActionsMenu, FormDialogButton } from "@/components/ui/actions";
import { Badge, EmptyState, PageHeader, Progress, Stat, StatGrid } from "@/components/ui/display";
import { SearchInput } from "@/components/ui/form";
import { FilterBar, FilterChips, TabsNav, hrefWith, param, type SearchParams } from "@/components/ui/nav";
import { DataTable } from "@/components/ui/table";
import { monthOf, monthRange, todayISO } from "@/lib/dates";
import { MATERIAL_KIND_LABELS } from "@/lib/domain";
import { formatMoney, formatNumber, formatQty } from "@/lib/format";
import { adjustMaterialAction, archiveMaterialAction, purchaseMaterialAction, saveMaterialAction, wasteMaterialAction } from "@/server/actions/materials";
import { requireCompany } from "@/server/context";
import { getMaterialKpis, listMaterials } from "@/server/queries/materials";

export const metadata: Metadata = { title: "Materiales" };

export default async function MaterialsPage({ params, searchParams }: { params: Promise<{ company: string }>; searchParams: Promise<SearchParams> }) {
  const { company, db, org } = await requireCompany((await params).company);
  const sp = await searchParams;
  const slug = company.slug;
  const basePath = `/e/${slug}/materiales`;
  const today = todayISO(org.timeZone);
  const month = monthRange(monthOf(today));
  const q = param(sp, "q");
  const lowOnly = param(sp, "bajo") === "1";
  const archived = param(sp, "archivados") === "1";
  const [list, kpis] = await Promise.all([listMaterials(db, company.id, { kind: param(sp, "tipo"), q, lowOnly, archived }), getMaterialKpis(db, company.id, month.from, month.to)]);
  const newButton = (
    <FormDialogButton label="Nuevo material" icon={<Plus />} variant="primary" title="Nuevo material" dialogSize="lg" action={saveMaterialAction.bind(null, slug)} submitLabel="Añadir material">
      <MaterialFields />
    </FormDialogButton>
  );
  const consumed = kpis.consumption.filter((c) => c.qty > 0 && c.unit !== "ud");

  return (
    <>
      <PageHeader title="Materiales" description="Filamentos, resinas, consumibles y embalaje. El stock baja solo con cada impresión y sube con cada compra." actions={newButton} />
      <StatGrid cols={4}>
        <Stat label="Valor del stock" value={formatMoney(Math.round(kpis.valueCents))} icon={<Cylinder />} />
        <Stat label="Bajo mínimo" value={kpis.low} hint={kpis.low > 0 ? <Badge tone="warn">Reponer</Badge> : "Todo en orden"} href={hrefWith(basePath, {}, { bajo: 1 })} />
        <Stat label="Consumo del mes" value={consumed.length ? consumed.map((c) => formatQty(c.qty, c.unit)).join(" · ") : "—"} />
        <Stat label="Compras del mes" value={formatMoney(kpis.purchaseCents)} icon={<ShoppingCart />} />
      </StatGrid>

      <TabsNav
        label="Clase de material"
        items={[
          { href: hrefWith(basePath, sp, { tipo: null }), label: "Todos", count: list.counts.todos, current: !list.kind },
          ...(["filament", "resin", "consumable", "packaging", "other"] as const)
            .filter((k) => list.counts[k] > 0 || list.kind === k)
            .map((k) => ({ href: hrefWith(basePath, sp, { tipo: k }), label: MATERIAL_KIND_LABELS[k], count: list.counts[k], current: list.kind === k })),
        ]}
      />
      <FilterBar>
        <SearchInput placeholder="Buscar material, marca o color…" />
        <FilterChips
          label="Filtros"
          items={[
            { href: hrefWith(basePath, sp, { bajo: lowOnly ? null : 1 }), label: "Solo stock bajo", current: lowOnly },
            { href: hrefWith(basePath, sp, { archivados: archived ? null : 1 }), label: "Archivados", current: archived },
          ]}
        />
      </FilterBar>

      <DataTable
        caption="Materiales"
        columns={[
          { key: "name", header: "Material" },
          { key: "type", header: "Tipo", hideBelow: "md" },
          { key: "stock", header: "Stock", className: "min-w-44" },
          { key: "min", header: "Mínimo", numeric: true, hideBelow: "lg" },
          { key: "price", header: "Precio envase", numeric: true, hideBelow: "md" },
          { key: "value", header: "Valor", numeric: true, hideBelow: "sm" },
          { key: "actions", header: <span className="sr-only">Acciones</span>, align: "right", className: "w-12 px-1" },
        ]}
        rows={list.rows.map((m) => {
          const out = m.stockQty <= 0;
          const low = !out && m.lowStockThreshold > 0 && m.stockQty < m.lowStockThreshold;
          const packs = m.packSize > 0 ? m.stockQty / m.packSize : 0;
          return {
            key: m.id,
            href: `${basePath}/${m.id}`,
            cells: [
              <span key="n" className="inline-flex max-w-64 items-center gap-2.5">
                <Swatch color={m.colorHex} />
                <span className="truncate">{m.name}</span>
              </span>,
              <span key="t" className="whitespace-nowrap text-fg-2">{[m.materialType, m.brand].filter(Boolean).join(" · ") || MATERIAL_KIND_LABELS[m.kind]}</span>,
              <div key="s">
                <div className="flex items-center justify-between gap-2">
                  <span className="whitespace-nowrap font-mono tabular">{formatQty(m.stockQty, m.unit)}</span>
                  {out ? <Badge tone="danger">Agotado</Badge> : low ? <Badge tone="warn">Stock bajo</Badge> : <span className="text-xs text-fg-3">≈ {formatNumber(packs, 1)} env.</span>}
                </div>
                <Progress value={m.packSize > 0 ? Math.min(100, (m.stockQty / Math.max(m.packSize, m.stockQty)) * 100) : 0} tone={out ? "danger" : low ? "warn" : "neutral"} label={`Stock de ${m.name}`} className="mt-1.5" />
              </div>,
              m.lowStockThreshold > 0 ? formatQty(m.lowStockThreshold, m.unit) : "—",
              m.packCostCents > 0 ? formatMoney(m.packCostCents) : "—",
              formatMoney(Math.round(packs * m.packCostCents)),
              <ActionsMenu
                key="a"
                size="sm"
                label={`Acciones de ${m.name}`}
                items={[
                  { type: "link", label: "Ver ficha", icon: <Eye />, href: `${basePath}/${m.id}` },
                  { type: "form", label: "Registrar compra", icon: <ShoppingCart />, title: `Compra de ${m.name}`, action: purchaseMaterialAction.bind(null, slug), submitLabel: "Registrar compra", content: <PurchaseFields material={m} today={today} vat={company.vatRatePct} /> },
                  { type: "form", label: "Ajustar stock", icon: <Scale />, title: `Ajustar stock de ${m.name}`, action: adjustMaterialAction.bind(null, slug), submitLabel: "Ajustar", content: <AdjustFields material={m} /> },
                  { type: "form", label: "Registrar merma", icon: <Trash />, title: `Merma de ${m.name}`, action: wasteMaterialAction.bind(null, slug), submitLabel: "Registrar merma", content: <WasteFields material={m} /> },
                  { type: "form", label: "Editar", icon: <Pencil />, title: "Editar material", dialogSize: "lg", action: saveMaterialAction.bind(null, slug), content: <MaterialFields material={m} /> },
                  { type: "separator" },
                  { type: "action", label: archived ? "Recuperar" : "Archivar", icon: <Archive />, action: archiveMaterialAction.bind(null, slug, m.id, !archived) },
                ]}
              />,
            ],
          };
        })}
        empty={
          q || lowOnly || archived || list.counts.todos > 0 ? (
            <EmptyState title={lowOnly && !q ? "Ningún material bajo mínimo" : archived && !q ? "No hay materiales archivados" : "Sin resultados para estos filtros"} />
          ) : (
            <EmptyState icon={<Cylinder />} title="Aún no hay materiales" description="Da de alta tus bobinas, resinas y embalajes con su precio. Así sabrás el coste de cada pieza y cuándo toca reponer." action={newButton} />
          )
        }
      />
    </>
  );
}
