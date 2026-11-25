import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Pencil, Trash2, Truck, Wallet } from "lucide-react";
import { z } from "zod";
import { NEXT_STATUS, OrderStatusBadge, PaymentBadge } from "@/components/orders/shared";
import { ActionButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader } from "@/components/ui/display";
import { ConfirmButton } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { carrierLabel, trackingUrlFor } from "@/lib/carriers";
import { computeUnitCost, netOfVat } from "@/lib/costing";
import { PAYMENT_METHOD_LABELS, PRINT_JOB_STATUS_LABELS, SALES_CHANNEL_LABELS, SHIPMENT_STATUS_LABELS } from "@/lib/domain";
import { averageKwhPrice } from "@/lib/energy";
import { formatDate, formatDateShort, formatMoney, formatPercent } from "@/lib/format";
import { deleteOrderAction, setOrderPaidAction, setOrderStatusAction } from "@/server/actions/orders";
import { requireCompany } from "@/server/context";
import { getOrder } from "@/server/queries/orders";

type Props = { params: Promise<{ company: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { company: slug, id } = await params;
  const { company, db } = await requireCompany(slug);
  const data = z.uuid().safeParse(id).success ? await getOrder(db, company.id, id) : null;
  return { title: data ? `Pedido ${data.order.number}` : "Pedido" };
}

export default async function OrderPage({ params }: Props) {
  const { company: slugParam, id } = await params;
  const { company, db, org } = await requireCompany(slugParam);
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getOrder(db, company.id, id);
  if (!data) notFound();
  const { order: o, items, shipments, jobs, customer } = data;
  const slug = company.slug;
  const base = `/e/${slug}`;
  const next = NEXT_STATUS[o.status];
  const safeUrl = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null);

  // Rentabilidad estimada: solo líneas con producto y receta.
  const kwhPrice = averageKwhPrice(company);
  let costCents = 0;
  let coveredCents = 0;
  let uncovered = 0;
  for (const { item, product, material, machine } of items) {
    if (!product) {
      uncovered += 1;
      continue;
    }
    const unit = computeUnitCost({
      materialQty: product.materialQty,
      materialPackCostCents: material?.packCostCents ?? 0,
      materialPackSize: material?.packSize ?? 0,
      printMinutes: product.printMinutes,
      machinePowerW: machine?.powerPrintW ?? 0,
      kwhPrice,
      machinePurchasePriceCents: machine?.purchasePriceCents,
      machineLifespanHours: machine?.lifespanHours,
      laborMinutes: product.laborMinutes,
      laborRateCents: company.laborRateCents,
      packagingCostCents: product.packagingCostCents,
      otherCostCents: product.otherCostCents,
      failureRatePct: company.failureRatePct,
    });
    costCents += unit.totalCents * item.quantity;
    coveredCents += item.totalCents;
  }
  const shippingCost = shipments.reduce((a, s) => a + s.costCents, 0);
  // Ingreso neto: líneas con producto − descuento + envío cobrado, todo sin IVA.
  const netRevenue = netOfVat(Math.max(0, coveredCents - o.discountCents + o.shippingChargedCents), o.vatRatePct);
  const profit = netRevenue - costCents - o.feesCents - shippingCost;

  return (
    <>
      <PageHeader
        back={{ href: `${base}/pedidos`, label: "Pedidos" }}
        eyebrow={`${formatDate(o.orderDate)} · ${SALES_CHANNEL_LABELS[o.channel]}`}
        title={`Pedido ${o.number}`}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={o.status} />
            <PaymentBadge status={o.paymentStatus} />
            {o.dueDate ? <span className="text-fg-3">Fecha límite: {formatDate(o.dueDate)}</span> : null}
          </span>
        }
        actions={
          <>
            {next ? (
              <ActionButton variant="primary" action={setOrderStatusAction.bind(null, slug, o.id, next.status)}>
                {next.label}
              </ActionButton>
            ) : null}
            {o.paymentStatus === "unpaid" && o.status !== "cancelled" ? (
              <ActionButton icon={<Wallet />} action={setOrderPaidAction.bind(null, slug, o.id, true)}>
                Marcar cobrado
              </ActionButton>
            ) : null}
            <Button href={`${base}/envios?nuevo=1&pedido=${o.id}`} icon={<Truck />}>
              Crear envío
            </Button>
            <Button href={`${base}/pedidos/${o.id}/editar`} icon={<Pencil />}>
              Editar
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Table>
            <caption className="sr-only">Líneas del pedido</caption>
            <THead>
              <tr>
                <TH>Concepto</TH>
                <TH align="right">Cant.</TH>
                <TH align="right" hideBelow="sm">Precio</TH>
                <TH align="right">Importe</TH>
              </tr>
            </THead>
            <TBody>
              {items.map(({ item, product }) => (
                <TR key={item.id}>
                  <TD>
                    {product ? (
                      <Link href={`${base}/productos/${product.id}`} className="font-medium underline-offset-4 hover:underline">
                        {item.description}
                      </Link>
                    ) : (
                      <span className="font-medium">{item.description}</span>
                    )}
                    {product?.sku ? <span className="block font-mono text-xs text-fg-3">{product.sku}</span> : null}
                  </TD>
                  <TD numeric>{item.quantity}</TD>
                  <TD numeric hideBelow="sm">{formatMoney(item.unitPriceCents)}</TD>
                  <TD numeric>{formatMoney(item.totalCents)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <Card>
            <CardBody>
              <dl className="ml-auto flex max-w-xs flex-col gap-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-fg-2">Subtotal</dt><dd className="font-mono tabular">{formatMoney(o.subtotalCents)}</dd></div>
                {o.discountCents > 0 ? <div className="flex justify-between"><dt className="text-fg-2">Descuento</dt><dd className="font-mono tabular">−{formatMoney(o.discountCents)}</dd></div> : null}
                <div className="flex justify-between"><dt className="text-fg-2">Envío cobrado</dt><dd className="font-mono tabular">{formatMoney(o.shippingChargedCents)}</dd></div>
                <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2.5"><dt className="font-semibold">Total</dt><dd className="font-mono text-xl font-medium tabular">{formatMoney(o.totalCents)}</dd></div>
                <p className="text-right text-[0.8125rem] text-fg-3">De los cuales IVA ({o.vatRatePct} %): {formatMoney(o.totalCents - netOfVat(o.totalCents, o.vatRatePct))}</p>
                {o.feesCents > 0 ? <p className="text-right text-[0.8125rem] text-fg-3">Comisiones de plataforma: {formatMoney(o.feesCents)}</p> : null}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Envíos" action={<Button size="sm" href={`${base}/envios?nuevo=1&pedido=${o.id}`} icon={<Truck />}>Crear envío</Button>} />
            <CardBody className="pt-3">
              {shipments.length === 0 ? (
                <p className="text-sm text-fg-2">Este pedido aún no tiene envíos.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {shipments.map((s) => {
                    const url = safeUrl(s.trackingUrl) ?? trackingUrlFor(s.carrier, s.trackingNumber);
                    return (
                      <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
                        <span className="font-medium">{carrierLabel(s.carrier)}</span>
                        {s.trackingNumber ? (
                          url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[0.8125rem] underline underline-offset-4 hover:text-fg-2">
                              {s.trackingNumber} <ExternalLink className="size-3" aria-hidden="true" />
                            </a>
                          ) : (
                            <span className="font-mono text-[0.8125rem] text-fg-2">{s.trackingNumber}</span>
                          )
                        ) : null}
                        <Badge tone={s.status === "delivered" ? "ok" : s.status === "incident" ? "danger" : "outline"}>{SHIPMENT_STATUS_LABELS[s.status]}</Badge>
                        <span className="ml-auto text-fg-3">{s.shippedAt ? formatDateShort(s.shippedAt) : "Sin enviar"} · {formatMoney(s.costCents)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>

          {jobs.length > 0 ? (
            <Card>
              <CardHeader title="Impresiones de este pedido" />
              <CardBody className="pt-3">
                <ul className="divide-y divide-line">
                  {jobs.map((j) => (
                    <li key={j.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="truncate">{j.name}</span>
                      <span className="shrink-0 text-fg-3">{formatDateShort(j.startedAt, org.timeZone)} · {PRINT_JOB_STATUS_LABELS[j.status]}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Cliente" />
            <CardBody>
              <p className="text-sm font-medium">
                {customer ? (
                  <Link href={`${base}/clientes/${customer.id}`} className="underline underline-offset-4 hover:text-fg-2">
                    {o.customerName}
                  </Link>
                ) : (
                  o.customerName
                )}
              </p>
              {customer?.email ? <p className="text-sm text-fg-2">{customer.email}</p> : null}
              {customer?.phone ? <p className="text-sm text-fg-2">{customer.phone}</p> : null}
              <div className="mt-4 border-t border-line pt-4 text-sm">
                <p className="text-[0.8125rem] text-fg-3">Dirección de envío</p>
                {o.shipAddressLine || o.shipCity ? (
                  <address className="mt-1 not-italic text-fg-2">
                    {o.shipName}
                    <br />
                    {o.shipAddressLine}
                    <br />
                    {[o.shipPostalCode, o.shipCity].filter(Boolean).join(" ")}
                    {o.shipProvince ? `, ${o.shipProvince}` : ""}
                    <br />
                    {o.shipCountry}
                  </address>
                ) : (
                  <p className="mt-1 text-fg-2">Sin dirección</p>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Cobro" />
            <CardBody>
              <DescriptionList
                cols={1}
                items={[
                  { term: "Estado", value: <PaymentBadge status={o.paymentStatus} /> },
                  { term: "Fecha de cobro", value: o.paidAt ? formatDate(o.paidAt) : "—" },
                  { term: "Método", value: o.paymentMethod ? PAYMENT_METHOD_LABELS[o.paymentMethod] : "—" },
                ]}
              />
              {o.paymentStatus === "paid" ? (
                <div className="mt-4">
                  <ActionButton size="sm" action={setOrderPaidAction.bind(null, slug, o.id, false)}>
                    Deshacer cobro
                  </ActionButton>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Rentabilidad estimada" description="Según la receta de cada producto. Orientativa." />
            <CardBody>
              {coveredCents === 0 ? (
                <p className="text-sm text-fg-2">Ninguna línea está asociada a un producto con receta.</p>
              ) : (
                <>
                  <dl className="flex flex-col gap-1.5 text-sm">
                    <div className="flex justify-between"><dt className="text-fg-2">Ingreso neto (sin IVA)</dt><dd className="font-mono tabular">{formatMoney(netRevenue)}</dd></div>
                    <div className="flex justify-between"><dt className="text-fg-2">Coste de fabricación</dt><dd className="font-mono tabular">−{formatMoney(costCents)}</dd></div>
                    {o.feesCents > 0 ? <div className="flex justify-between"><dt className="text-fg-2">Comisiones</dt><dd className="font-mono tabular">−{formatMoney(o.feesCents)}</dd></div> : null}
                    {shippingCost > 0 ? <div className="flex justify-between"><dt className="text-fg-2">Coste de envío</dt><dd className="font-mono tabular">−{formatMoney(shippingCost)}</dd></div> : null}
                    <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2.5">
                      <dt className="font-semibold">Beneficio</dt>
                      <dd className={`font-mono text-lg font-medium tabular ${profit < 0 ? "text-danger" : ""}`}>{formatMoney(profit)}</dd>
                    </div>
                  </dl>
                  {netRevenue > 0 ? <p className="mt-1 text-right text-[0.8125rem] text-fg-3">Margen {formatPercent((profit / netRevenue) * 100)}</p> : null}
                  {uncovered > 0 ? <p className="mt-2 text-[0.8125rem] text-fg-3">{uncovered} {uncovered === 1 ? "línea libre no se incluye" : "líneas libres no se incluyen"} en el cálculo.</p> : null}
                </>
              )}
            </CardBody>
          </Card>

          {o.notes ? (
            <Card>
              <CardHeader title="Notas" />
              <CardBody className="whitespace-pre-wrap text-sm text-fg-2">{o.notes}</CardBody>
            </Card>
          ) : null}

          <ConfirmButton
            action={deleteOrderAction.bind(null, slug, o.id)}
            title={`¿Eliminar el pedido ${o.number}?`}
            description="Se eliminarán también su ingreso y sus comisiones en Finanzas, y las unidades volverán al stock. No se puede deshacer."
            confirmLabel="Eliminar pedido"
            icon={<Trash2 />}
            variant="ghost"
            className="self-start text-danger hover:text-danger"
          >
            Eliminar pedido
          </ConfirmButton>
        </div>
      </div>
    </>
  );
}
