import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, PackageOpen, Pencil, Plus, Send, Trash2, Truck } from "lucide-react";
import { z } from "zod";
import { ShipmentFields } from "@/components/shipments/shipment-fields";
import { ActionsMenu, FormDialogButton, type ActionsMenuItem } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/client-bits";
import { Badge, Card, EmptyState, PageHeader, Stat, StatGrid } from "@/components/ui/display";
import { SearchInput, SelectFilter } from "@/components/ui/form";
import { FilterBar, Pagination, TabsNav, hrefWith, param, type SearchParams } from "@/components/ui/nav";
import { DataTable } from "@/components/ui/table";
import { CARRIERS, carrierLabel, trackingUrlFor } from "@/lib/carriers";
import { addDays, monthOf, monthRange, todayISO } from "@/lib/dates";
import { SHIPMENT_STATUS_LABELS, type ShipmentStatus } from "@/lib/domain";
import { formatDateShort, formatMoney, formatNumber } from "@/lib/format";
import { deleteShipmentAction, saveShipmentAction, setShipmentStatusAction } from "@/server/actions/shipments";
import { requireCompany } from "@/server/context";
import { listOrderOptions } from "@/server/queries/orders";
import { SHIPMENT_GROUPS, getShipmentKpis, listReadyWithoutShipment, listShipments, type ShipmentGroup } from "@/server/queries/shipments";

export const metadata: Metadata = { title: "Envíos" };

const GROUP_LABELS: Record<ShipmentGroup, string> = { curso: "En curso", entregados: "Entregados", devueltos: "Devueltos", todos: "Todos" };
const TONE: Record<ShipmentStatus, "outline" | "solid" | "ok" | "danger" | "neutral"> = {
  pending: "outline",
  label_created: "outline",
  in_transit: "solid",
  out_for_delivery: "solid",
  delivered: "ok",
  incident: "danger",
  returned: "neutral",
};

export default async function ShipmentsPage({ params, searchParams }: { params: Promise<{ company: string }>; searchParams: Promise<SearchParams> }) {
  const { company, db, org } = await requireCompany((await params).company);
  const sp = await searchParams;
  const slug = company.slug;
  const basePath = `/e/${slug}/envios`;
  const today = todayISO(org.timeZone);
  const rawGroup = param(sp, "estado");
  const group: ShipmentGroup = (SHIPMENT_GROUPS as readonly string[]).includes(rawGroup ?? "") ? (rawGroup as ShipmentGroup) : "curso";
  const q = param(sp, "q");
  const rawCarrier = param(sp, "transportista");
  const carrier = CARRIERS.some((c) => c.id === rawCarrier) ? rawCarrier : undefined;
  const month = monthRange(monthOf(today));

  const [list, kpis, ready, orderOptions] = await Promise.all([
    listShipments(db, company.id, { group, q, carrier, page: Number(param(sp, "pag")) || 1 }),
    getShipmentKpis(db, company.id, month.from, month.to, addDays(today, -90)),
    listReadyWithoutShipment(db, company.id),
    listOrderOptions(db, company.id),
  ]);
  const save = saveShipmentAction.bind(null, slug);

  // Alta abierta desde un pedido: /envios?nuevo=1&pedido=<id>
  const prefillId = param(sp, "pedido");
  const prefill = param(sp, "nuevo") === "1" && z.uuid().safeParse(prefillId).success ? orderOptions.find((o) => o.id === prefillId) : undefined;
  const newButton = (
    <FormDialogButton label="Nuevo envío" icon={<Plus />} variant="primary" title="Nuevo envío" dialogSize="lg" action={save} submitLabel="Crear envío" defaultOpen={param(sp, "nuevo") === "1"}>
      <ShipmentFields
        orders={orderOptions}
        defaults={prefill ? { orderId: prefill.id, recipientName: prefill.shipName ?? prefill.customerName, destination: [prefill.shipCity, prefill.shipCountry].filter(Boolean).join(", ") } : undefined}
      />
    </FormDialogButton>
  );
  const safeUrl = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null);

  return (
    <>
      <PageHeader title="Envíos" description="Sigue cada paquete hasta la entrega. El coste del envío se apunta solo como gasto y el pedido se actualiza al enviarlo." actions={newButton} />
      <StatGrid cols={5} className="md:grid-cols-3">
        <Stat label="Por preparar" value={kpis.pending} icon={<PackageOpen />} />
        <Stat label="En tránsito" value={kpis.moving} icon={<Truck />} />
        <Stat label="Incidencias" value={kpis.incidents} icon={<AlertTriangle />} hint={kpis.incidents > 0 ? <Badge tone="danger">Revisar</Badge> : undefined} />
        <Stat label="Coste del mes" value={formatMoney(kpis.monthCostCents)} />
        <Stat label="Plazo medio de entrega" value={kpis.deliveredCount > 0 ? `${formatNumber(kpis.deliveredDays / kpis.deliveredCount, 1)} días` : "—"} hint="Últimos 90 días" className="col-span-2 md:col-span-1" />
      </StatGrid>

      {ready.length > 0 ? (
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Pedidos listos sin envío</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {ready.map((o) => (
              <li key={o.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2 text-sm">
                <span>
                  <Link href={`/e/${slug}/pedidos/${o.id}`} className="font-mono font-medium underline-offset-4 hover:underline">
                    {o.number}
                  </Link>
                  <span className="text-fg-2"> · {o.customerName}</span>
                </span>
                <Button size="sm" href={`${basePath}?nuevo=1&pedido=${o.id}`} icon={<Send />}>
                  Crear envío
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <TabsNav label="Estado de los envíos" items={SHIPMENT_GROUPS.map((g) => ({ href: hrefWith(basePath, sp, { estado: g === "curso" ? null : g, pag: null, nuevo: null, pedido: null }), label: GROUP_LABELS[g], count: list.counts[g], current: g === group }))} />
      <FilterBar>
        <SearchInput placeholder="Buscar seguimiento, destinatario o pedido…" className="sm:w-80" />
        <SelectFilter param="transportista" label="Transportista" options={[{ value: "", label: "Todos los transportistas" }, ...CARRIERS.map((c) => ({ value: c.id, label: c.label }))]} />
      </FilterBar>

      <DataTable
        caption="Envíos"
        columns={[
          { key: "date", header: "Envío" },
          { key: "order", header: "Pedido", hideBelow: "sm" },
          { key: "to", header: "Destinatario" },
          { key: "carrier", header: "Transportista", hideBelow: "md" },
          { key: "tracking", header: "Seguimiento", hideBelow: "lg" },
          { key: "status", header: "Estado" },
          { key: "eta", header: "Entrega prevista", hideBelow: "lg" },
          { key: "cost", header: "Coste", numeric: true, hideBelow: "sm" },
          { key: "actions", header: <span className="sr-only">Acciones</span>, align: "right", className: "w-12 px-1" },
        ]}
        rows={list.rows.map(({ shipment: s, orderNumber }) => {
          const url = safeUrl(s.trackingUrl) ?? trackingUrlFor(s.carrier, s.trackingNumber);
          const late = s.estimatedDelivery !== null && s.estimatedDelivery < today && (s.status === "in_transit" || s.status === "out_for_delivery");
          const items: ActionsMenuItem[] = [];
          if (s.status === "pending" || s.status === "label_created") items.push({ type: "action", label: "Marcar enviado", icon: <Send />, action: setShipmentStatusAction.bind(null, slug, s.id, "in_transit") });
          if (s.status !== "delivered" && s.status !== "returned") items.push({ type: "action", label: "Marcar entregado", icon: <CheckCircle2 />, action: setShipmentStatusAction.bind(null, slug, s.id, "delivered") });
          if (s.status !== "incident" && s.status !== "delivered" && s.status !== "returned") items.push({ type: "action", label: "Marcar incidencia", icon: <AlertTriangle />, action: setShipmentStatusAction.bind(null, slug, s.id, "incident") });
          items.push({ type: "form", label: "Editar", icon: <Pencil />, title: "Editar envío", dialogSize: "lg", action: save, content: <ShipmentFields shipment={s} orders={orderOptions} currentOrderNumber={orderNumber} /> });
          items.push({ type: "separator" });
          items.push({ type: "confirm", label: "Eliminar", icon: <Trash2 />, danger: true, title: "¿Eliminar este envío?", description: "También se eliminará su gasto en Finanzas. El pedido no cambia de estado.", action: deleteShipmentAction.bind(null, slug, s.id) });
          return {
            key: s.id,
            cells: [
              <span key="d" className="whitespace-nowrap text-fg-2">{s.shippedAt ? formatDateShort(s.shippedAt) : "Sin enviar"}</span>,
              orderNumber && s.orderId ? (
                <Link key="o" href={`/e/${slug}/pedidos/${s.orderId}`} className="whitespace-nowrap font-mono underline-offset-4 hover:underline">
                  {orderNumber}
                </Link>
              ) : (
                "—"
              ),
              <div key="t" className="max-w-48">
                <p className="truncate font-medium">{s.recipientName ?? "—"}</p>
                {s.destination ? <p className="truncate text-[0.8125rem] text-fg-3">{s.destination}</p> : null}
              </div>,
              <div key="c" className="whitespace-nowrap">
                <p>{carrierLabel(s.carrier)}</p>
                {s.service ? <p className="text-[0.8125rem] text-fg-3">{s.service}</p> : null}
              </div>,
              s.trackingNumber ? (
                <span key="tr" className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[0.8125rem]">
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-fg-2">
                      {s.trackingNumber}
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  ) : (
                    s.trackingNumber
                  )}
                  <CopyButton value={s.trackingNumber} label="Copiar número de seguimiento" />
                </span>
              ) : (
                "—"
              ),
              <Badge key="s" tone={TONE[s.status]}>{SHIPMENT_STATUS_LABELS[s.status]}</Badge>,
              s.estimatedDelivery ? (
                <span key="e" className="inline-flex items-center gap-2 whitespace-nowrap text-fg-2">
                  {formatDateShort(s.estimatedDelivery)}
                  {late ? <Badge tone="warn">Con retraso</Badge> : null}
                </span>
              ) : (
                "—"
              ),
              s.costCents > 0 ? formatMoney(s.costCents) : "—",
              <ActionsMenu key="m" size="sm" label="Acciones del envío" items={items} />,
            ],
          };
        })}
        empty={
          list.counts.todos > 0 || q || carrier ? (
            <EmptyState title={q || carrier ? "Sin resultados para estos filtros" : `No hay envíos en «${GROUP_LABELS[group]}»`} />
          ) : (
            <EmptyState icon={<Truck />} title="Aún no hay envíos" description="Crea un envío desde aquí o desde la ficha de un pedido. Guarda el número de seguimiento y el coste: el gasto se apunta solo." action={newButton} />
          )
        }
      />
      <Pagination page={list.page} pageCount={list.pageCount} total={list.total} basePath={basePath} searchParams={sp} />
    </>
  );
}
