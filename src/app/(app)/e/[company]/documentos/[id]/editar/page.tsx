import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DocumentForm } from "@/components/documents/document-form";
import { PageHeader } from "@/components/ui/display";
import { centsToInput, numberToInput } from "@/lib/format";
import { DOCUMENT_KIND_LABELS } from "@/lib/domain";
import { requireCompany } from "@/server/context";
import { getDocument, listDocumentCustomers, listInvoiceOptions } from "@/server/queries/documents";
import { listProductOptions } from "@/server/queries/orders";

export const metadata: Metadata = { title: "Editar documento" };

export default async function EditDocumentPage({ params }: { params: Promise<{ company: string; id: string }> }) {
  const { company: slug, id } = await params;
  const { company, db } = await requireCompany(slug);
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getDocument(db, company.id, id);
  if (!data) notFound();
  const { doc, items, order, rectifies } = data;
  const [products, customers, invoices] = await Promise.all([
    listProductOptions(db, company.id),
    listDocumentCustomers(db, company.id),
    doc.kind === "rectifying" ? listInvoiceOptions(db, company.id) : Promise.resolve([]),
  ]);
  const c = doc.customer;
  const base = `/e/${company.slug}/documentos`;
  return (
    <>
      <PageHeader back={{ href: `${base}/${doc.id}`, label: `${DOCUMENT_KIND_LABELS[doc.kind]} ${doc.number}` }} title={`Editar ${DOCUMENT_KIND_LABELS[doc.kind].toLowerCase()} ${doc.number}`} />
      <DocumentForm
        slug={company.slug}
        cancelHref={`${base}/${doc.id}`}
        products={products}
        customers={customers}
        invoices={invoices.filter((i) => i.id !== doc.id).map((i) => ({ id: i.id, number: i.number, issueDate: i.issueDate, customerName: i.customer.name, totalCents: i.totalCents }))}
        initial={{
          id: doc.id,
          kind: doc.kind,
          number: doc.number,
          issueDate: doc.issueDate,
          dueDate: doc.dueDate ?? "",
          orderId: doc.orderId ?? "",
          orderNumber: order?.number,
          rectifiesId: doc.rectifiesId ?? "",
          rectifiesNumber: rectifies?.number,
          rectificationReason: doc.rectificationReason ?? "",
          customerId: doc.customerId ?? "",
          customer: {
            name: c.name,
            taxId: c.taxId ?? "",
            addressLine: c.addressLine ?? "",
            postalCode: c.postalCode ?? "",
            city: c.city ?? "",
            province: c.province ?? "",
            country: c.country ?? "",
            email: c.email ?? "",
            phone: c.phone ?? "",
          },
          pricesIncludeVat: doc.pricesIncludeVat,
          showPrices: doc.showPrices,
          vatRatePct: numberToInput(doc.vatRatePct),
          irpfRatePct: numberToInput(doc.irpfRatePct),
          discount: doc.discountCents ? centsToInput(doc.discountCents) : "",
          shipping: doc.shippingCents ? centsToInput(doc.shippingCents) : "",
          paymentMethod: doc.paymentMethod ?? "",
          notes: doc.notes ?? "",
          terms: doc.terms ?? "",
          items: items.map((i) => ({ productId: i.productId ?? "", description: i.description, quantity: numberToInput(i.quantity), unitPrice: centsToInput(i.unitPriceCents) })),
        }}
      />
    </>
  );
}
