import type { Metadata } from "next";
import { Plus, Users } from "lucide-react";
import { CustomerFields } from "@/components/orders/customer-fields";
import { FormDialogButton } from "@/components/ui/actions";
import { EmptyState, PageHeader } from "@/components/ui/display";
import { SearchInput, SelectFilter } from "@/components/ui/form";
import { FilterBar, Pagination, param, type SearchParams } from "@/components/ui/nav";
import { DataTable } from "@/components/ui/table";
import { formatDateShort, formatMoney } from "@/lib/format";
import { saveCustomerAction } from "@/server/actions/orders";
import { requireCompany } from "@/server/context";
import { listCustomers } from "@/server/queries/orders";

export const metadata: Metadata = { title: "Clientes" };

export default async function CustomersPage({ params, searchParams }: { params: Promise<{ company: string }>; searchParams: Promise<SearchParams> }) {
  const { company, db } = await requireCompany((await params).company);
  const sp = await searchParams;
  const slug = company.slug;
  const basePath = `/e/${slug}/clientes`;
  const q = param(sp, "q");
  const rawSort = param(sp, "orden");
  const sort = rawSort === "reciente" || rawSort === "nombre" ? rawSort : "gasto";
  const list = await listCustomers(db, company.id, { q, sort, page: Number(param(sp, "pag")) || 1 });
  const newButton = (
    <FormDialogButton label="Nuevo cliente" icon={<Plus />} variant="primary" title="Nuevo cliente" action={saveCustomerAction.bind(null, slug)}>
      <CustomerFields />
    </FormDialogButton>
  );
  return (
    <>
      <PageHeader title="Clientes" description="Quién te compra, cuánto y cuándo fue la última vez." actions={newButton} />
      <FilterBar>
        <SearchInput placeholder="Buscar nombre, correo o ciudad…" />
        <SelectFilter param="orden" label="Orden" options={[{ value: "", label: "Mayor gasto primero" }, { value: "reciente", label: "Pedido más reciente" }, { value: "nombre", label: "Por nombre" }]} />
      </FilterBar>
      <DataTable
        caption="Clientes"
        columns={[
          { key: "name", header: "Cliente" },
          { key: "contact", header: "Contacto", hideBelow: "md" },
          { key: "city", header: "Ciudad", hideBelow: "sm" },
          { key: "orders", header: "Pedidos", numeric: true },
          { key: "spent", header: "Total gastado", numeric: true },
          { key: "last", header: "Último pedido", hideBelow: "lg" },
        ]}
        rows={list.rows.map(({ customer: c, orderCount, spentCents, lastOrder }) => ({
          key: c.id,
          href: `${basePath}/${c.id}`,
          cells: [
            <span key="n" className="block max-w-56 truncate">{c.name}</span>,
            <span key="c" className="block max-w-56 truncate text-fg-2">{c.email ?? c.phone ?? "—"}</span>,
            <span key="ci" className="whitespace-nowrap text-fg-2">{c.city ?? "—"}</span>,
            orderCount,
            formatMoney(spentCents),
            <span key="l" className="whitespace-nowrap text-fg-2">{lastOrder ? formatDateShort(lastOrder) : "—"}</span>,
          ],
        }))}
        empty={q ? <EmptyState title="Sin resultados" description="Ningún cliente coincide con la búsqueda." /> : <EmptyState icon={<Users />} title="Aún no hay clientes" description="Puedes darlos de alta aquí o guardarlos al crear un pedido." action={newButton} />}
      />
      <Pagination page={list.page} pageCount={list.pageCount} total={list.total} basePath={basePath} searchParams={sp} />
    </>
  );
}
