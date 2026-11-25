import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { z } from "zod";
import { CustomerFields } from "@/components/orders/customer-fields";
import { OrderStatusBadge, PaymentBadge } from "@/components/orders/shared";
import { FormDialogButton } from "@/components/ui/actions";
import { Card, CardBody, CardHeader, DescriptionList, EmptyState, PageHeader, Stat, StatGrid } from "@/components/ui/display";
import { ConfirmButton } from "@/components/ui/dialog";
import { DataTable } from "@/components/ui/table";
import { formatDate, formatDateShort, formatMoney } from "@/lib/format";
import { deleteCustomerAction, saveCustomerAction } from "@/server/actions/orders";
import { requireCompany } from "@/server/context";
import { getCustomer, listOrders } from "@/server/queries/orders";

export const metadata: Metadata = { title: "Cliente" };

export default async function CustomerPage({ params }: { params: Promise<{ company: string; id: string }> }) {
  const { company: slugParam, id } = await params;
  const { company, db } = await requireCompany(slugParam);
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getCustomer(db, company.id, id);
  if (!data) notFound();
  const { customer: c, stats } = data;
  const slug = company.slug;
  const orders = await listOrders(db, company.id, { group: "todos", customerId: c.id, pageSize: 50 });
  return (
    <>
      <PageHeader
        back={{ href: `/e/${slug}/clientes`, label: "Clientes" }}
        title={c.name}
        description={[c.city, c.country].filter(Boolean).join(", ") || undefined}
        actions={
          <>
            <FormDialogButton label="Editar" icon={<Pencil />} title="Editar cliente" action={saveCustomerAction.bind(null, slug)}>
              <CustomerFields customer={c} />
            </FormDialogButton>
            <ConfirmButton
              action={deleteCustomerAction.bind(null, slug, c.id)}
              title={`¿Eliminar a ${c.name}?`}
              description="Sus pedidos se conservan con el nombre del cliente, pero sin ficha asociada."
              icon={<Trash2 />}
            >
              Eliminar
            </ConfirmButton>
          </>
        }
      />
      <StatGrid cols={4}>
        <Stat label="Pedidos" value={stats.orders} />
        <Stat label="Total gastado" value={formatMoney(stats.spentCents)} />
        <Stat label="Ticket medio" value={stats.paidOrders > 0 ? formatMoney(Math.round(stats.spentCents / stats.paidOrders)) : "—"} />
        <Stat label="Último pedido" value={stats.last ? formatDateShort(stats.last) : "—"} hint={stats.first ? `Cliente desde ${formatDate(stats.first)}` : undefined} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DataTable
            caption="Pedidos del cliente"
            columns={[
              { key: "number", header: "Pedido" },
              { key: "date", header: "Fecha" },
              { key: "status", header: "Estado" },
              { key: "payment", header: "Cobro", hideBelow: "sm" },
              { key: "total", header: "Total", numeric: true },
            ]}
            rows={orders.rows.map((o) => ({
              key: o.id,
              href: `/e/${slug}/pedidos/${o.id}`,
              cells: [<span key="n" className="font-mono tabular">{o.number}</span>, <span key="d" className="whitespace-nowrap text-fg-2">{formatDateShort(o.orderDate)}</span>, <OrderStatusBadge key="s" status={o.status} />, <PaymentBadge key="p" status={o.paymentStatus} />, formatMoney(o.totalCents)],
            }))}
            empty={<EmptyState title="Este cliente aún no tiene pedidos" />}
          />
        </div>
        <Card>
          <CardHeader title="Datos de contacto" />
          <CardBody>
            <DescriptionList
              cols={1}
              items={[
                { term: "Correo", value: c.email ?? "—" },
                { term: "Teléfono", value: c.phone ?? "—" },
                { term: "NIF / CIF", value: c.taxId ?? "—" },
                { term: "Dirección", value: [c.addressLine, [c.postalCode, c.city].filter(Boolean).join(" "), c.province, c.country].filter(Boolean).join(", ") || "—" },
                { term: "Notas", value: c.notes ?? "—" },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
