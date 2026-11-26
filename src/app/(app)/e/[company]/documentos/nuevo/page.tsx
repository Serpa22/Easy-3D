import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DocumentForm } from "@/components/documents/document-form";
import { PageHeader } from "@/components/ui/display";
import { param, type SearchParams } from "@/components/ui/nav";
import { todayISO } from "@/lib/dates";
import { kindFromSlug } from "@/lib/documents";
import { DOCUMENT_KIND_LABELS } from "@/lib/domain";
import { requireCompany } from "@/server/context";
import { draftFromDocument, draftFromOrder, emptyDraft } from "@/server/domain/documents-service";
import { listDocumentCustomers, listInvoiceOptions } from "@/server/queries/documents";
import { listProductOptions } from "@/server/queries/orders";

export const metadata: Metadata = { title: "Nuevo documento" };

const isId = (v: string | undefined): v is string => z.uuid().safeParse(v).success;

/**
 * Alta de un documento. `?tipo=factura|rectificativa|presupuesto|albaran`;
 * opcionalmente `?pedido=<id>` (rellena desde un pedido) o `?desde=<id>`
 * (desde otro documento: rectificar, facturar un presupuesto, sacar un albarán…).
 */
export default async function NewDocumentPage({ params, searchParams }: { params: Promise<{ company: string }>; searchParams: Promise<SearchParams> }) {
  const { company, db, org } = await requireCompany((await params).company);
  const sp = await searchParams;
  const kind = kindFromSlug(param(sp, "tipo")) ?? "invoice";
  const today = todayISO(org.timeZone);
  const orderId = param(sp, "pedido");
  const fromId = param(sp, "desde");

  let draft = emptyDraft(company, kind, today);
  if (isId(fromId)) {
    const d = await draftFromDocument(db, company, fromId, kind, today);
    if (!d) notFound();
    draft = d;
  } else if (isId(orderId)) {
    const d = await draftFromOrder(db, company, orderId, kind, today);
    if (!d) notFound();
    draft = d;
  }

  const [products, customers, invoices] = await Promise.all([
    listProductOptions(db, company.id),
    listDocumentCustomers(db, company.id),
    kind === "rectifying" ? listInvoiceOptions(db, company.id) : Promise.resolve([]),
  ]);
  const base = `/e/${company.slug}/documentos`;
  const cancelHref = isId(fromId) ? `${base}/${fromId}` : isId(orderId) ? `/e/${company.slug}/pedidos/${orderId}` : base;
  const title = `${kind === "quote" || kind === "delivery_note" ? "Nuevo" : "Nueva"} ${DOCUMENT_KIND_LABELS[kind].toLowerCase()}`;

  return (
    <>
      <PageHeader back={{ href: base, label: "Documentos" }} title={title} description={draft.orderNumber ? `A partir del pedido ${draft.orderNumber}.` : draft.rectifiesNumber ? `Corrige la factura ${draft.rectifiesNumber}.` : undefined} />
      <DocumentForm
        slug={company.slug}
        initial={draft}
        products={products}
        customers={customers}
        invoices={invoices.map((i) => ({ id: i.id, number: i.number, issueDate: i.issueDate, customerName: i.customer.name, totalCents: i.totalCents }))}
        cancelHref={cancelHref}
      />
    </>
  );
}
