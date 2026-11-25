import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { OrderForm } from "@/components/orders/order-form";
import { PageHeader } from "@/components/ui/display";
import { todayISO } from "@/lib/dates";
import { centsToInput } from "@/lib/format";
import { requireCompany } from "@/server/context";
import { getOrder, listCustomerOptions, listProductOptions } from "@/server/queries/orders";

export const metadata: Metadata = { title: "Editar pedido" };

export default async function EditOrderPage({ params }: { params: Promise<{ company: string; id: string }> }) {
  const { company: slugParam, id } = await params;
  const { company, db, org } = await requireCompany(slugParam);
  if (!z.uuid().safeParse(id).success) notFound();
  const [data, products, customers] = await Promise.all([getOrder(db, company.id, id), listProductOptions(db, company.id), listCustomerOptions(db, company.id)]);
  if (!data) notFound();
  const o = data.order;
  return (
    <>
      <PageHeader back={{ href: `/e/${company.slug}/pedidos/${o.id}`, label: `Pedido ${o.number}` }} title={`Editar pedido ${o.number}`} />
      <OrderForm
        slug={company.slug}
        products={products}
        customers={customers}
        vatRatePct={o.vatRatePct}
        initial={{
          id: o.id,
          customerId: o.customerId ?? "",
          customerName: o.customerName,
          channel: o.channel,
          status: o.status,
          paymentStatus: o.paymentStatus,
          paymentMethod: o.paymentMethod ?? "",
          orderDate: o.orderDate,
          dueDate: o.dueDate ?? "",
          paidAt: o.paidAt ?? todayISO(org.timeZone),
          discount: centsToInput(o.discountCents || null),
          shippingCharged: centsToInput(o.shippingChargedCents || null),
          fees: centsToInput(o.feesCents || null),
          shipName: o.shipName ?? "",
          shipAddressLine: o.shipAddressLine ?? "",
          shipPostalCode: o.shipPostalCode ?? "",
          shipCity: o.shipCity ?? "",
          shipProvince: o.shipProvince ?? "",
          shipCountry: o.shipCountry ?? "",
          notes: o.notes ?? "",
          items: data.items.map(({ item }) => ({ productId: item.productId ?? "", description: item.description, quantity: String(item.quantity), unitPrice: centsToInput(item.unitPriceCents) })),
        }}
      />
    </>
  );
}
