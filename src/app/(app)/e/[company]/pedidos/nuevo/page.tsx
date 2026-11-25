import type { Metadata } from "next";
import { OrderForm } from "@/components/orders/order-form";
import { PageHeader } from "@/components/ui/display";
import { todayISO } from "@/lib/dates";
import { requireCompany } from "@/server/context";
import { listCustomerOptions, listProductOptions } from "@/server/queries/orders";

export const metadata: Metadata = { title: "Nuevo pedido" };

export default async function NewOrderPage({ params }: { params: Promise<{ company: string }> }) {
  const { company, db, org } = await requireCompany((await params).company);
  const [products, customers] = await Promise.all([listProductOptions(db, company.id), listCustomerOptions(db, company.id)]);
  const today = todayISO(org.timeZone);
  return (
    <>
      <PageHeader back={{ href: `/e/${company.slug}/pedidos`, label: "Pedidos" }} title="Nuevo pedido" />
      <OrderForm
        slug={company.slug}
        products={products}
        customers={customers}
        vatRatePct={company.vatRatePct}
        initial={{
          customerId: "", customerName: "", channel: "web", status: "pending", paymentStatus: "unpaid", paymentMethod: "", orderDate: today, dueDate: "", paidAt: today,
          discount: "", shippingCharged: "", fees: "", shipName: "", shipAddressLine: "", shipPostalCode: "", shipCity: "", shipProvince: "", shipCountry: "España", notes: "", items: [],
        }}
      />
    </>
  );
}
