/** Lecturas de documentos (facturas, rectificativas, presupuestos, albaranes). Todas filtran por empresa. */
import "server-only";
import { and, asc, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { customers, documentItems, documents, orders } from "@/server/db/schema";
import { count, countWhere, sumWhere } from "@/server/db/sql";
import { DOCUMENT_KINDS, type DocumentKind } from "@/lib/domain";

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export interface DocumentFilters {
  kind?: DocumentKind;
  q?: string;
  page?: number;
  pageSize?: number;
}

export async function listDocuments(db: DbOrTx, companyId: string, f: DocumentFilters = {}) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 200);
  const base: SQL[] = [eq(documents.companyId, companyId)];
  const q = f.q?.trim();
  if (q) base.push(or(ilike(documents.number, like(q)), ilike(sql`${documents.customer}->>'name'`, like(q))) as SQL);

  const [counts] = await db
    .select({
      invoice: countWhere(sql`${documents.kind} = 'invoice'`),
      rectifying: countWhere(sql`${documents.kind} = 'rectifying'`),
      quote: countWhere(sql`${documents.kind} = 'quote'`),
      delivery_note: countWhere(sql`${documents.kind} = 'delivery_note'`),
      all: count(),
    })
    .from(documents)
    .where(and(...base));

  const where = f.kind ? and(...base, eq(documents.kind, f.kind)) : and(...base);
  const total = f.kind ? counts[f.kind] : counts.all;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(f.page ?? 1, 1), pageCount);
  const rows = await db
    .select({
      id: documents.id,
      kind: documents.kind,
      status: documents.status,
      number: documents.number,
      issueDate: documents.issueDate,
      dueDate: documents.dueDate,
      customer: documents.customer,
      totalCents: documents.totalCents,
      amountDueCents: documents.amountDueCents,
      showPrices: documents.showPrices,
      orderId: documents.orderId,
    })
    .from(documents)
    .where(where)
    .orderBy(desc(documents.issueDate), desc(documents.year), desc(documents.seq))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total, page, pageCount, counts };
}

/** Resumen del año: facturado (facturas + rectificativas) y presupuestos pendientes. */
export async function getDocumentKpis(db: DbOrTx, companyId: string, range: { from: string; to: string }) {
  const inRange = sql`${documents.issueDate} >= ${range.from} and ${documents.issueDate} <= ${range.to}`;
  const [row] = await db
    .select({
      invoicedCents: sumWhere(documents.totalCents, sql`${documents.kind} in ('invoice','rectifying') and ${inRange}`),
      baseCents: sumWhere(documents.baseCents, sql`${documents.kind} in ('invoice','rectifying') and ${inRange}`),
      vatCents: sumWhere(documents.vatCents, sql`${documents.kind} in ('invoice','rectifying') and ${inRange}`),
      invoices: countWhere(sql`${documents.kind} = 'invoice' and ${inRange}`),
      pendingQuotes: countWhere(sql`${documents.kind} = 'quote' and ${documents.status} = 'issued'`),
      pendingQuotesCents: sumWhere(documents.totalCents, sql`${documents.kind} = 'quote' and ${documents.status} = 'issued'`),
    })
    .from(documents)
    .where(eq(documents.companyId, companyId));
  return row;
}

export async function getDocument(db: DbOrTx, companyId: string, id: string) {
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.companyId, companyId))).limit(1);
  if (!doc) return null;
  const [items, order, rectifies, rectifiedBy] = await Promise.all([
    db.select().from(documentItems).where(eq(documentItems.documentId, doc.id)).orderBy(asc(documentItems.sortOrder)),
    doc.orderId
      ? db.select({ id: orders.id, number: orders.number }).from(orders).where(and(eq(orders.id, doc.orderId), eq(orders.companyId, companyId))).limit(1)
      : Promise.resolve([]),
    doc.rectifiesId
      ? db
          .select({ id: documents.id, number: documents.number, issueDate: documents.issueDate })
          .from(documents)
          .where(and(eq(documents.id, doc.rectifiesId), eq(documents.companyId, companyId)))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({ id: documents.id, number: documents.number, issueDate: documents.issueDate, totalCents: documents.totalCents })
      .from(documents)
      .where(and(eq(documents.companyId, companyId), eq(documents.rectifiesId, doc.id)))
      .orderBy(asc(documents.issueDate)),
  ]);
  return { doc, items, order: order[0] ?? null, rectifies: rectifies[0] ?? null, rectifiedBy };
}

/** Documentos emitidos para un pedido (ficha del pedido). */
export async function listOrderDocuments(db: DbOrTx, companyId: string, orderId: string) {
  return db
    .select({ id: documents.id, kind: documents.kind, number: documents.number, issueDate: documents.issueDate, totalCents: documents.totalCents, status: documents.status })
    .from(documents)
    .where(and(eq(documents.companyId, companyId), eq(documents.orderId, orderId)))
    .orderBy(asc(documents.issueDate), asc(documents.createdAt));
}

/** Clientes con sus datos fiscales, para rellenar el documento. */
export async function listDocumentCustomers(db: DbOrTx, companyId: string) {
  return db
    .select({
      id: customers.id,
      name: customers.name,
      taxId: customers.taxId,
      addressLine: customers.addressLine,
      postalCode: customers.postalCode,
      city: customers.city,
      province: customers.province,
      country: customers.country,
      email: customers.email,
      phone: customers.phone,
    })
    .from(customers)
    .where(eq(customers.companyId, companyId))
    .orderBy(asc(customers.name));
}

/** Facturas que se pueden rectificar (las más recientes primero). */
export async function listInvoiceOptions(db: DbOrTx, companyId: string, range?: { from: string; to: string }) {
  const where: SQL[] = [eq(documents.companyId, companyId), eq(documents.kind, "invoice")];
  if (range) where.push(gte(documents.issueDate, range.from), lte(documents.issueDate, range.to));
  return db
    .select({ id: documents.id, number: documents.number, issueDate: documents.issueDate, customer: documents.customer, totalCents: documents.totalCents })
    .from(documents)
    .where(and(...where))
    .orderBy(desc(documents.issueDate), desc(documents.seq))
    .limit(200);
}

export function isDocumentKind(value: unknown): value is DocumentKind {
  return typeof value === "string" && (DOCUMENT_KINDS as readonly string[]).includes(value);
}
