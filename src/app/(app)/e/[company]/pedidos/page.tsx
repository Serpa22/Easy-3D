import type { Metadata } from "next";
import { Ban, CheckCircle2, Eye, Factory, PackageCheck, Plus, ShoppingBag, Truck, Wallet } from "lucide-react";
import { OrderStatusBadge, PaymentBadge } from "@/components/orders/shared";
import { ActionsMenu, type ActionsMenuItem } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Stat, StatGrid } from "@/components/ui/display";
import { SearchInput, SelectFilter } from "@/components/ui/form";
import { FilterBar, Pagination, TabsNav, hrefWith, param, type SearchParams } from "@/components/ui/nav";
import { DataTable } from "@/components/ui/table";
import { monthOf, monthRange, todayISO } from "@/lib/dates";
import { OPEN_ORDER_STATUSES, SALES_CHANNELS, SALES_CHANNEL_LABELS } from "@/lib/domain";
import { formatDateShort, formatMoney, formatMonth } from "@/lib/format";
import { setOrderPaidAction, setOrderStatusAction } from "@/server/actions/orders";
import { requireCompany } from "@/server/context";
import { ORDER_GROUPS, getOrderKpis, listOrders, type OrderGroup } from "@/server/queries/orders";

export const metadata: Metadata = { title: "Pedidos" };

const GROUP_LABELS: Record<OrderGroup, string> = { abiertos: "Abiertos", enviados: "Enviados", entregados: "Entregados", cancelados: "Cancelados y devueltos", todos: "Todos" };

export default async function OrdersPage({ params, searchParams }: { params: Promise<{ company: string }>; searchParams: Promise<SearchParams> }) {
  const { company, db, org } = await requireCompany((await params).company);
  const sp = await searchParams;
  const slug = company.slug;
  const basePath = `/e/${slug}/pedidos`;
  const today = todayISO(org.timeZone);
  const rawGroup = param(sp, "estado");
  const group: OrderGroup = (ORDER_GROUPS as readonly string[]).includes(rawGroup ?? "") ? (rawGroup as OrderGroup) : "abiertos";
  const q = param(sp, "q");
  const channel = param(sp, "canal");

  const [list, kpis] = await Promise.all([
    listOrders(db, company.id, { group, q, channel, page: Number(param(sp, "pag")) || 1 }),
    getOrderKpis(db, company.id, monthRange(monthOf(today))),
  ]);
  const newButton = (
    <Button href={`${basePath}/nuevo`} variant="primary" icon={<Plus />}>
      Nuevo pedido
    </Button>
  );

  return (
    <>
      <PageHeader title="Pedidos" description="Del encargo a la entrega. Al cobrar un pedido, el ingreso se apunta solo en Finanzas; al enviarlo, se descuenta el stock." actions={newButton} />
      <StatGrid cols={4}>
        <Stat label="Pedidos abiertos" value={kpis.open} icon={<ShoppingBag />} />
        <Stat label="Pendiente de cobro" value={formatMoney(kpis.unpaidCents)} icon={<Wallet />} />
        <Stat label={`Ventas de ${formatMonth(monthOf(today)).split(" ")[0]}`} value={formatMoney(kpis.monthSalesCents)} hint={`${kpis.monthPaidOrders} cobrados`} />
        <Stat label="Ticket medio" value={kpis.monthPaidOrders > 0 ? formatMoney(Math.round(kpis.monthSalesCents / kpis.monthPaidOrders)) : "—"} hint="Este mes" />
      </StatGrid>

      <TabsNav
        label="Estado de los pedidos"
        items={ORDER_GROUPS.map((g) => ({ href: hrefWith(basePath, sp, { estado: g === "abiertos" ? null : g, pag: null }), label: GROUP_LABELS[g], count: list.counts[g], current: g === group }))}
      />
      <FilterBar>
        <SearchInput placeholder="Buscar número o cliente…" />
        <SelectFilter param="canal" label="Canal de venta" options={[{ value: "", label: "Todos los canales" }, ...SALES_CHANNELS.map((c) => ({ value: c, label: SALES_CHANNEL_LABELS[c] }))]} />
      </FilterBar>

      <DataTable
        caption="Pedidos"
        columns={[
          { key: "number", header: "Pedido" },
          { key: "date", header: "Fecha", hideBelow: "sm" },
          { key: "customer", header: "Cliente" },
          { key: "channel", header: "Canal", hideBelow: "lg" },
          { key: "status", header: "Estado" },
          { key: "payment", header: "Cobro", hideBelow: "md" },
          { key: "due", header: "Fecha límite", hideBelow: "lg" },
          { key: "total", header: "Total", numeric: true },
          { key: "actions", header: <span className="sr-only">Acciones</span>, align: "right", className: "w-12 px-1" },
        ]}
        rows={list.rows.map((o) => {
          const open = OPEN_ORDER_STATUSES.includes(o.status);
          const overdue = open && o.dueDate !== null && o.dueDate < today;
          const items: ActionsMenuItem[] = [{ type: "link", label: "Ver pedido", icon: <Eye />, href: `${basePath}/${o.id}` }];
          if (o.status === "pending") items.push({ type: "action", label: "Pasar a producción", icon: <Factory />, action: setOrderStatusAction.bind(null, slug, o.id, "in_production") });
          if (o.status === "in_production") items.push({ type: "action", label: "Marcar listo", icon: <PackageCheck />, action: setOrderStatusAction.bind(null, slug, o.id, "ready") });
          if (o.status === "ready") items.push({ type: "action", label: "Marcar enviado", icon: <Truck />, action: setOrderStatusAction.bind(null, slug, o.id, "shipped") });
          if (o.status === "shipped") items.push({ type: "action", label: "Marcar entregado", icon: <CheckCircle2 />, action: setOrderStatusAction.bind(null, slug, o.id, "delivered") });
          if (o.paymentStatus === "unpaid" && o.status !== "cancelled") items.push({ type: "action", label: "Marcar cobrado", icon: <Wallet />, action: setOrderPaidAction.bind(null, slug, o.id, true) });
          if (open) {
            items.push({ type: "separator" });
            items.push({
              type: "confirm",
              label: "Cancelar pedido",
              icon: <Ban />,
              danger: true,
              title: `¿Cancelar el pedido ${o.number}?`,
              description: "Quedará en «Cancelados». Si estaba cobrado, recuerda marcar el reembolso al editarlo.",
              confirmLabel: "Cancelar pedido",
              action: setOrderStatusAction.bind(null, slug, o.id, "cancelled"),
            });
          }
          return {
            key: o.id,
            href: `${basePath}/${o.id}`,
            cells: [
              <span key="n" className="whitespace-nowrap font-mono tabular">{o.number}</span>,
              <span key="d" className="whitespace-nowrap text-fg-2">{formatDateShort(o.orderDate)}</span>,
              <span key="c" className="block max-w-48 truncate">{o.customerName}</span>,
              <span key="ch" className="whitespace-nowrap text-fg-2">{SALES_CHANNEL_LABELS[o.channel]}</span>,
              <OrderStatusBadge key="s" status={o.status} />,
              <PaymentBadge key="p" status={o.paymentStatus} />,
              o.dueDate ? (
                <span key="du" className="inline-flex items-center gap-2 whitespace-nowrap text-fg-2">
                  {formatDateShort(o.dueDate)}
                  {overdue ? <Badge tone="warn">Vencida</Badge> : null}
                </span>
              ) : (
                "—"
              ),
              formatMoney(o.totalCents),
              <ActionsMenu key="m" size="sm" label={`Acciones del pedido ${o.number}`} items={items} />,
            ],
          };
        })}
        empty={
          q || channel || list.counts.todos > 0 ? (
            <EmptyState title={list.counts.todos > 0 && !q && !channel ? `No hay pedidos en «${GROUP_LABELS[group]}»` : "Sin resultados para estos filtros"} description="Prueba con otra pestaña u otro texto de búsqueda." />
          ) : (
            <EmptyState icon={<ShoppingBag />} title="Aún no hay pedidos" description="Registra los encargos de tus clientes con sus líneas, el canal de venta y el cobro. Las finanzas y el stock se actualizan solos." action={newButton} />
          )
        }
      />
      <Pagination page={list.page} pageCount={list.pageCount} total={list.total} basePath={basePath} searchParams={sp} />
    </>
  );
}
