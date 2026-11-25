import type { Metadata } from "next";
import { Calculator, Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Stat, StatGrid } from "@/components/ui/display";
import { SearchInput, SelectFilter } from "@/components/ui/form";
import { FilterBar, FilterChips, hrefWith, param, type SearchParams } from "@/components/ui/nav";
import { DataTable } from "@/components/ui/table";
import { marginOf } from "@/lib/costing";
import { addDays, todayISO } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/format";
import { productUnitCost } from "@/lib/product-cost";
import { requireCompany } from "@/server/context";
import { listProducts } from "@/server/queries/products";

export const metadata: Metadata = { title: "Productos" };

const VIEWS = [
  { value: "activos", label: "Activos" },
  { value: "sin-stock", label: "Sin stock" },
  { value: "margen-bajo", label: "Margen bajo" },
  { value: "inactivos", label: "Inactivos" },
  { value: "todos", label: "Todos" },
] as const;
type View = (typeof VIEWS)[number]["value"];

export default async function ProductsPage({ params, searchParams }: { params: Promise<{ company: string }>; searchParams: Promise<SearchParams> }) {
  const { company, db, org } = await requireCompany((await params).company);
  const sp = await searchParams;
  const slug = company.slug;
  const basePath = `/e/${slug}/productos`;
  const today = todayISO(org.timeZone);
  const q = param(sp, "q");
  const rawView = param(sp, "ver");
  const view: View = VIEWS.some((v) => v.value === rawView) ? (rawView as View) : "activos";
  const data = await listProducts(db, company.id, { q, category: param(sp, "cat"), since30: addDays(today, -30) });

  const all = data.rows.map((r) => {
    const cost = productUnitCost(r.product, r.material, r.machine, company);
    return { ...r, cost, margin: marginOf(r.product.priceCents, cost.totalCents, company.vatRatePct) };
  });
  const lowMargin = (x: (typeof all)[number]) => x.product.priceCents > 0 && x.cost.totalCents > 0 && x.margin.marginPct < company.targetMarginPct;
  const rows = all.filter((x) => {
    if (view === "todos") return true;
    if (view === "inactivos") return !x.product.active;
    if (!x.product.active) return false;
    if (view === "sin-stock") return x.product.stockQty <= 0;
    if (view === "margen-bajo") return lowMargin(x);
    return true;
  });
  const active = all.filter((x) => x.product.active);
  const withCost = active.filter((x) => x.cost.totalCents > 0 && x.product.priceCents > 0);
  const avgMargin = withCost.length ? withCost.reduce((a, x) => a + x.margin.marginPct, 0) / withCost.length : null;
  const stockValue = active.reduce((a, x) => a + x.cost.totalCents * x.product.stockQty, 0);
  const newButton = (
    <Button href={`${basePath}/nuevo`} variant="primary" icon={<Plus />}>
      Nuevo producto
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Productos"
        description="Tu catálogo con el coste real de cada pieza: material, luz, máquina, mano de obra y embalaje."
        actions={
          <>
            <Button href={`${basePath}/calculadora`} icon={<Calculator />}>
              Calculadora de costes
            </Button>
            {newButton}
          </>
        }
      />
      <StatGrid cols={4}>
        <Stat label="Productos activos" value={active.length} icon={<Package />} />
        <Stat label="Margen medio" value={avgMargin === null ? "—" : formatPercent(avgMargin)} hint={`Objetivo ${formatPercent(company.targetMarginPct)}`} />
        <Stat label="Sin stock" value={active.filter((x) => x.product.stockQty <= 0).length} href={hrefWith(basePath, {}, { ver: "sin-stock" })} />
        <Stat label="Stock a precio de coste" value={formatMoney(stockValue)} />
      </StatGrid>

      <FilterBar>
        <FilterChips label="Vista" items={VIEWS.map((v) => ({ href: hrefWith(basePath, sp, { ver: v.value === "activos" ? null : v.value }), label: v.label, current: v.value === view }))} />
        <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row">
          {data.categories.length > 0 ? <SelectFilter param="cat" label="Categoría" options={[{ value: "", label: "Todas las categorías" }, ...data.categories.map((c) => ({ value: c, label: c }))]} /> : null}
          <SearchInput placeholder="Buscar nombre o SKU…" />
        </div>
      </FilterBar>

      <DataTable
        caption="Productos"
        columns={[
          { key: "name", header: "Producto" },
          { key: "cat", header: "Categoría", hideBelow: "lg" },
          { key: "price", header: "Precio", numeric: true },
          { key: "cost", header: "Coste", numeric: true, hideBelow: "sm" },
          { key: "margin", header: "Margen", numeric: true },
          { key: "stock", header: "Stock", numeric: true, hideBelow: "sm" },
          { key: "sold", header: "Vendidos 30 d", numeric: true, hideBelow: "md" },
        ]}
        rows={rows.map(({ product: p, cost, margin, sold30 }) => ({
          key: p.id,
          href: `${basePath}/${p.id}`,
          cells: [
            <span key="n" className="inline-flex max-w-72 flex-col">
              <span className="truncate">{p.name}</span>
              <span className="flex items-center gap-2 font-mono text-xs font-normal text-fg-3">
                {p.sku ?? "Sin SKU"}
                {!p.active ? <Badge>Inactivo</Badge> : null}
              </span>
            </span>,
            <span key="c" className="whitespace-nowrap text-fg-2">{p.category ?? "—"}</span>,
            formatMoney(p.priceCents),
            cost.totalCents > 0 ? formatMoney(cost.totalCents) : "—",
            cost.totalCents > 0 && p.priceCents > 0 ? (
              <span key="m" className={margin.profitCents < 0 ? "text-danger" : margin.marginPct < company.targetMarginPct ? "text-warn" : ""}>{formatPercent(margin.marginPct)}</span>
            ) : (
              "—"
            ),
            <span key="s" className="inline-flex items-center gap-2">
              {p.stockQty <= 0 ? <Badge tone="danger">Agotado</Badge> : p.lowStockThreshold > 0 && p.stockQty <= p.lowStockThreshold ? <Badge tone="warn">Bajo</Badge> : null}
              {p.stockQty}
            </span>,
            sold30,
          ],
        }))}
        empty={
          all.length > 0 || q ? (
            <EmptyState title="Sin resultados para esta vista" description="Cambia de vista o de búsqueda." />
          ) : (
            <EmptyState icon={<Package />} title="Aún no hay productos" description="Crea tus productos con su receta (material, tiempo de impresión, mano de obra) y sabrás al momento el coste de cada pieza y el margen que te deja." action={newButton} />
          )
        }
      />
    </>
  );
}
