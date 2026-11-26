/**
 * Documentos comerciales: alta, edición, borrado y borradores a partir de un
 * pedido u otro documento. Funciones puras de (db, empresa, datos); las Server
 * Actions son envoltorios finos.
 *
 * Reglas:
 *  - Numeración correlativa por empresa, tipo y año («F2026-0007»).
 *  - Facturas y rectificativas: la fecha no puede romper el orden de la serie
 *    y solo se puede borrar la última (su número se libera). Para corregir una
 *    factura emitida se hace una rectificativa.
 *  - Los documentos no tocan Finanzas ni stock.
 */
import "server-only";
import { and, asc, desc, eq, gt, inArray, lt, max, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/server/db";
import { customers, documentItems, documentSequences, documents, orderItems, orders, products, type Company, type Customer, type DocumentRow } from "@/server/db/schema";
import { addDays } from "@/lib/dates";
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABELS, FISCAL_DOCUMENT_KINDS, PAYMENT_METHODS, type DocumentKind, type DocumentStatus } from "@/lib/domain";
import { computeDocumentTotals, formatDocumentNumber, lineTotalCents, type DocumentDraft, type DocumentParty } from "@/lib/documents";
import { centsToInput, numberToInput } from "@/lib/format";
import { zCents, zDate, zDecimal, zOptionalCents, zOptionalDate, zOptionalId, zOptionalText, zText } from "@/lib/validation";
import { ActionError } from "@/server/action";

/* ------------------------------- Validación ------------------------------- */

export const documentInputSchema = z.object({
  id: zOptionalId(),
  kind: z.enum(DOCUMENT_KINDS),
  issueDate: zDate(),
  dueDate: zOptionalDate(),
  orderId: zOptionalId(),
  rectifiesId: zOptionalId(),
  rectificationReason: zOptionalText(500),
  customerId: zOptionalId(),
  customer: z.object({
    name: zText(160),
    taxId: zOptionalText(30),
    addressLine: zOptionalText(200),
    postalCode: zOptionalText(20),
    city: zOptionalText(80),
    province: zOptionalText(80),
    country: zOptionalText(80),
    email: zOptionalText(160),
    phone: zOptionalText(40),
  }),
  pricesIncludeVat: z.boolean().default(false),
  showPrices: z.boolean().default(true),
  vatRatePct: zDecimal({ min: 0, max: 100 }),
  irpfRatePct: zDecimal({ min: 0, max: 50 }),
  discount: zOptionalCents(0),
  shipping: z.preprocess((v) => (v === "" || v === null || v === undefined ? "0" : v), zCents({ min: -1_000_000_000 })),
  paymentMethod: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.enum(PAYMENT_METHODS).optional()),
  notes: zOptionalText(2000),
  terms: zOptionalText(4000),
  items: z
    .array(
      z.object({
        productId: zOptionalId(),
        description: zText(300),
        quantity: zDecimal({ min: -100000, max: 100000 }),
        unitPrice: zCents({ min: -1_000_000_000 }),
      }),
    )
    .min(1, "Añade al menos una línea")
    .max(200),
});
export type DocumentInput = z.output<typeof documentInputSchema>;

/* ------------------------------ Datos de partes ------------------------------ */

/** Datos del emisor tal y como están ahora en los ajustes de la sub-empresa. */
export function issuerFromCompany(c: Company): DocumentParty {
  return {
    name: c.legalName || c.name,
    taxId: c.taxId,
    addressLine: c.fiscalAddressLine,
    postalCode: c.fiscalPostalCode,
    city: c.fiscalCity,
    province: c.fiscalProvince,
    country: c.fiscalCountry,
    email: c.contactEmail,
    phone: c.contactPhone,
    website: c.website,
    iban: c.iban,
  };
}

function seriesFor(c: Company, kind: DocumentKind): string {
  switch (kind) {
    case "invoice":
      return c.invoicePrefix;
    case "rectifying":
      return c.rectifyingPrefix;
    case "quote":
      return c.quotePrefix;
    case "delivery_note":
      return c.deliveryPrefix;
  }
}

const yearOf = (dateISO: string) => Number(dateISO.slice(0, 4));

/* ------------------------------- Numeración ------------------------------- */

/** Reserva el siguiente número de la serie. Llamar dentro de la transacción del alta. */
export async function reserveDocumentSeq(tx: DbOrTx, companyId: string, kind: DocumentKind, year: number): Promise<number> {
  const [row] = await tx
    .insert(documentSequences)
    .values({ companyId, kind, year, lastSeq: 1 })
    .onConflictDoUpdate({
      target: [documentSequences.companyId, documentSequences.kind, documentSequences.year],
      set: { lastSeq: sql`${documentSequences.lastSeq} + 1` },
    })
    .returning({ lastSeq: documentSequences.lastSeq });
  return row.lastSeq;
}

/**
 * En facturas y rectificativas las fechas deben seguir el orden de los
 * números: ni anterior a la del número previo ni posterior a la del siguiente.
 */
async function assertChronology(tx: DbOrTx, companyId: string, kind: DocumentKind, year: number, seq: number | null, issueDate: string) {
  if (!FISCAL_DOCUMENT_KINDS.includes(kind)) return;
  const scope = and(eq(documents.companyId, companyId), eq(documents.kind, kind), eq(documents.year, year));
  const [prev] = await tx
    .select({ number: documents.number, issueDate: documents.issueDate })
    .from(documents)
    .where(seq === null ? scope : and(scope, lt(documents.seq, seq)))
    .orderBy(desc(documents.seq))
    .limit(1);
  if (prev && prev.issueDate > issueDate) {
    throw new ActionError("La fecha rompe el orden de la numeración.", {
      issueDate: `No puede ser anterior a la de ${prev.number} (${prev.issueDate.split("-").reverse().join("/")})`,
    });
  }
  if (seq === null) return;
  const [next] = await tx
    .select({ number: documents.number, issueDate: documents.issueDate })
    .from(documents)
    .where(and(scope, gt(documents.seq, seq)))
    .orderBy(asc(documents.seq))
    .limit(1);
  if (next && next.issueDate < issueDate) {
    throw new ActionError("La fecha rompe el orden de la numeración.", {
      issueDate: `No puede ser posterior a la de ${next.number} (${next.issueDate.split("-").reverse().join("/")})`,
    });
  }
}

/* ------------------------------ Alta y edición ------------------------------ */

/** Crea o edita un documento (cabecera + líneas). */
export async function saveDocument(db: Db, company: Company, input: DocumentInput): Promise<{ id: string; number: string }> {
  const kind = input.kind;
  const rectifying = kind === "rectifying";

  // Reglas de signo y campos obligatorios por tipo.
  const fieldErrors: Record<string, string> = {};
  input.items.forEach((item, i) => {
    if (item.quantity === 0) fieldErrors[`items.${i}.quantity`] = "No puede ser 0";
    else if (!rectifying && item.quantity < 0) fieldErrors[`items.${i}.quantity`] = "Debe ser positiva";
    if (!rectifying && item.unitPrice < 0) fieldErrors[`items.${i}.unitPrice`] = "No puede ser negativo";
  });
  if (!rectifying && input.shipping < 0) fieldErrors.shipping = "No puede ser negativo";
  if (rectifying && !input.rectifiesId) fieldErrors.rectifiesId = "Elige la factura que se rectifica";
  if (rectifying && !input.rectificationReason) fieldErrors.rectificationReason = "Indica el motivo de la rectificación";
  if (input.dueDate && input.dueDate < input.issueDate) fieldErrors.dueDate = "No puede ser anterior a la fecha de emisión";
  if (Object.keys(fieldErrors).length > 0) throw new ActionError("Revisa los campos marcados.", fieldErrors);

  const totals = computeDocumentTotals({
    lines: input.items.map((i) => ({ quantity: i.quantity, unitPriceCents: i.unitPrice })),
    discountCents: input.discount ?? 0,
    shippingCents: input.shipping ?? 0,
    vatRatePct: input.vatRatePct,
    irpfRatePct: input.irpfRatePct,
    pricesIncludeVat: input.pricesIncludeVat,
  });
  if (!rectifying && totals.totalCents < 0) throw new ActionError("Revisa los importes.", { discount: "El descuento supera el importe del documento" });

  return db.transaction(async (tx) => {
    // Todo lo referenciado debe ser de esta empresa.
    const productIds = [...new Set(input.items.map((i) => i.productId).filter((id): id is string => Boolean(id)))];
    if (productIds.length > 0) {
      const found = await tx.select({ id: products.id }).from(products).where(and(eq(products.companyId, company.id), inArray(products.id, productIds)));
      if (found.length !== productIds.length) throw new ActionError("Alguno de los productos ya no existe.");
    }
    if (input.customerId) {
      const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, input.customerId), eq(customers.companyId, company.id))).limit(1);
      if (!c) throw new ActionError("El cliente ya no existe.");
    }
    if (input.orderId) {
      const [o] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.id, input.orderId), eq(orders.companyId, company.id))).limit(1);
      if (!o) throw new ActionError("El pedido ya no existe.");
    }
    if (rectifying && input.rectifiesId) {
      const [r] = await tx
        .select({ id: documents.id, kind: documents.kind, issueDate: documents.issueDate })
        .from(documents)
        .where(and(eq(documents.id, input.rectifiesId), eq(documents.companyId, company.id)))
        .limit(1);
      if (!r || r.kind !== "invoice") throw new ActionError("La factura que se rectifica ya no existe.");
      if (input.issueDate < r.issueDate) throw new ActionError("Revisa la fecha.", { issueDate: "Una rectificativa no puede ser anterior a la factura que corrige" });
    }

    const year = yearOf(input.issueDate);
    const values = {
      issueDate: input.issueDate,
      dueDate: kind === "invoice" || kind === "quote" ? input.dueDate : null,
      orderId: input.orderId,
      customerId: input.customerId,
      rectifiesId: rectifying ? input.rectifiesId : null,
      rectificationReason: rectifying ? input.rectificationReason : null,
      issuer: issuerFromCompany(company),
      customer: {
        name: input.customer.name,
        taxId: input.customer.taxId,
        addressLine: input.customer.addressLine,
        postalCode: input.customer.postalCode,
        city: input.customer.city,
        province: input.customer.province,
        country: input.customer.country,
        email: input.customer.email,
        phone: input.customer.phone,
      },
      pricesIncludeVat: input.pricesIncludeVat,
      showPrices: kind === "delivery_note" ? input.showPrices : true,
      vatRatePct: input.vatRatePct,
      irpfRatePct: kind === "delivery_note" ? 0 : input.irpfRatePct,
      ...totals,
      ...(kind === "delivery_note" ? { irpfCents: 0, amountDueCents: totals.totalCents } : {}),
      paymentMethod: input.paymentMethod ?? null,
      notes: input.notes,
      terms: input.terms,
      footer: company.documentFooter,
    };

    let documentId: string;
    let number: string;
    if (input.id) {
      const [existing] = await tx.select().from(documents).where(and(eq(documents.id, input.id), eq(documents.companyId, company.id))).limit(1);
      if (!existing) throw new ActionError("El documento ya no existe.");
      if (existing.kind !== kind) throw new ActionError("No se puede cambiar el tipo de un documento.");
      if (existing.year !== year) throw new ActionError("Revisa la fecha.", { issueDate: `Debe ser del ${existing.year}, el año de su número (${existing.number})` });
      await assertChronology(tx, company.id, kind, year, existing.seq, input.issueDate);
      await tx.update(documents).set(values).where(eq(documents.id, existing.id));
      await tx.delete(documentItems).where(eq(documentItems.documentId, existing.id));
      documentId = existing.id;
      number = existing.number;
    } else {
      await assertChronology(tx, company.id, kind, year, null, input.issueDate);
      const seq = await reserveDocumentSeq(tx, company.id, kind, year);
      const series = seriesFor(company, kind);
      number = formatDocumentNumber(series, year, seq);
      const [row] = await tx
        .insert(documents)
        .values({ ...values, companyId: company.id, kind, status: "issued", series, year, seq, number })
        .returning({ id: documents.id });
      documentId = row.id;
    }
    await tx.insert(documentItems).values(
      input.items.map((item, index) => ({
        documentId,
        productId: item.productId,
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unitPrice,
        totalCents: lineTotalCents(item.quantity, item.unitPrice),
        sortOrder: index,
      })),
    );
    return { id: documentId, number };
  });
}

/* --------------------------------- Borrado --------------------------------- */

/**
 * Borra un documento. Facturas y rectificativas: solo la última de su serie y
 * año (su número vuelve a quedar libre) y nunca una factura ya rectificada.
 */
export async function deleteDocument(db: Db, companyId: string, id: string): Promise<DocumentRow> {
  return db.transaction(async (tx) => {
    const [doc] = await tx.select().from(documents).where(and(eq(documents.id, id), eq(documents.companyId, companyId))).limit(1);
    if (!doc) throw new ActionError("El documento ya no existe.");
    const [seqRow] = await tx
      .select({ lastSeq: documentSequences.lastSeq })
      .from(documentSequences)
      .where(and(eq(documentSequences.companyId, companyId), eq(documentSequences.kind, doc.kind), eq(documentSequences.year, doc.year)))
      .limit(1);
    const isLast = seqRow?.lastSeq === doc.seq;
    if (FISCAL_DOCUMENT_KINDS.includes(doc.kind)) {
      if (!isLast) throw new ActionError(`Solo se puede eliminar la última de la serie. Para anular ${doc.number}, emite una factura rectificativa.`);
      const [rect] = await tx.select({ number: documents.number }).from(documents).where(and(eq(documents.companyId, companyId), eq(documents.rectifiesId, doc.id))).limit(1);
      if (rect) throw new ActionError(`No se puede eliminar: la rectifica ${rect.number}.`);
    }
    await tx.delete(documents).where(eq(documents.id, doc.id));
    if (isLast) {
      // Libera el número: el siguiente documento reutiliza el hueco que queda al final.
      const [{ top }] = await tx
        .select({ top: max(documents.seq) })
        .from(documents)
        .where(and(eq(documents.companyId, companyId), eq(documents.kind, doc.kind), eq(documents.year, doc.year)));
      await tx
        .update(documentSequences)
        .set({ lastSeq: Number(top ?? 0) })
        .where(and(eq(documentSequences.companyId, companyId), eq(documentSequences.kind, doc.kind), eq(documentSequences.year, doc.year)));
    }
    return doc;
  });
}

/** Si el documento es el último de su serie (y por tanto se puede borrar sin dejar huecos). */
export async function isLastOfSeries(db: DbOrTx, doc: Pick<DocumentRow, "companyId" | "kind" | "year" | "seq">): Promise<boolean> {
  const [row] = await db
    .select({ lastSeq: documentSequences.lastSeq })
    .from(documentSequences)
    .where(and(eq(documentSequences.companyId, doc.companyId), eq(documentSequences.kind, doc.kind), eq(documentSequences.year, doc.year)))
    .limit(1);
  return row?.lastSeq === doc.seq;
}

/** Aceptar o rechazar un presupuesto (o volver a dejarlo pendiente). */
export async function setQuoteStatus(db: DbOrTx, companyId: string, id: string, status: DocumentStatus): Promise<void> {
  const [doc] = await db.select({ kind: documents.kind }).from(documents).where(and(eq(documents.id, id), eq(documents.companyId, companyId))).limit(1);
  if (!doc) throw new ActionError("El documento ya no existe.");
  if (doc.kind !== "quote") throw new ActionError("Solo los presupuestos se aceptan o rechazan.");
  await db.update(documents).set({ status }).where(and(eq(documents.id, id), eq(documents.companyId, companyId)));
}

/* -------------------------------- Borradores -------------------------------- */

function blankCustomer(): DocumentDraft["customer"] {
  return { name: "", taxId: "", addressLine: "", postalCode: "", city: "", province: "", country: "", email: "", phone: "" };
}

export function customerToDraft(c: Pick<Customer, "name" | "taxId" | "addressLine" | "postalCode" | "city" | "province" | "country" | "email" | "phone">): DocumentDraft["customer"] {
  return {
    name: c.name,
    taxId: c.taxId ?? "",
    addressLine: c.addressLine ?? "",
    postalCode: c.postalCode ?? "",
    city: c.city ?? "",
    province: c.province ?? "",
    country: c.country ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
  };
}

function defaultDueDate(company: Company, kind: DocumentKind, issueDate: string): string {
  if (kind === "quote") return addDays(issueDate, company.quoteValidityDays);
  if (kind === "invoice" && company.paymentTermsDays > 0) return addDays(issueDate, company.paymentTermsDays);
  return "";
}

/** Documento nuevo en blanco con los valores por defecto de la sub-empresa. */
export function emptyDraft(company: Company, kind: DocumentKind, today: string): DocumentDraft {
  return {
    kind,
    issueDate: today,
    dueDate: defaultDueDate(company, kind, today),
    orderId: "",
    rectifiesId: "",
    rectificationReason: "",
    customerId: "",
    customer: blankCustomer(),
    pricesIncludeVat: false,
    showPrices: true,
    vatRatePct: numberToInput(company.vatRatePct),
    irpfRatePct: kind === "invoice" || kind === "rectifying" ? numberToInput(company.irpfRatePct) : "0",
    discount: "",
    shipping: "",
    paymentMethod: "",
    notes: "",
    terms: kind === "quote" ? (company.quoteTerms ?? "") : "",
    items: [{ productId: "", description: "", quantity: "1", unitPrice: "" }],
  };
}

/** Borrador a partir de un pedido: cliente, líneas e importes (IVA incluido, como el pedido). */
export async function draftFromOrder(db: DbOrTx, company: Company, orderId: string, kind: DocumentKind, today: string): Promise<DocumentDraft | null> {
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.companyId, company.id))).limit(1);
  if (!order) return null;
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.sortOrder));
  const [cust] = order.customerId
    ? await db.select().from(customers).where(and(eq(customers.id, order.customerId), eq(customers.companyId, company.id))).limit(1)
    : [];
  const draft = emptyDraft(company, kind, today);
  const customer = cust
    ? customerToDraft(cust)
    : {
        ...blankCustomer(),
        name: order.customerName,
        addressLine: order.shipAddressLine ?? "",
        postalCode: order.shipPostalCode ?? "",
        city: order.shipCity ?? "",
        province: order.shipProvince ?? "",
        country: order.shipCountry ?? "",
      };
  return {
    ...draft,
    orderId: order.id,
    orderNumber: order.number,
    customerId: cust?.id ?? "",
    customer,
    pricesIncludeVat: true,
    vatRatePct: numberToInput(order.vatRatePct),
    // Factura de un pedido ya cobrado: sin vencimiento.
    dueDate: kind === "invoice" && order.paymentStatus === "paid" ? "" : draft.dueDate,
    paymentMethod: order.paymentMethod ?? "",
    discount: order.discountCents ? centsToInput(order.discountCents) : "",
    shipping: order.shippingChargedCents ? centsToInput(order.shippingChargedCents) : "",
    notes: kind === "delivery_note" ? `Pedido ${order.number}` : `Pedido ${order.number} del ${order.orderDate.split("-").reverse().join("/")}`,
    items: items.map((i) => ({ productId: i.productId ?? "", description: i.description, quantity: String(i.quantity), unitPrice: centsToInput(i.unitPriceCents) })),
  };
}

/**
 * Borrador a partir de otro documento:
 *  - rectificativa de una factura (líneas en negativo para anularla; se pueden ajustar),
 *  - factura de un presupuesto aceptado,
 *  - albarán de una factura o presupuesto,
 *  - o una copia del mismo tipo.
 */
export async function draftFromDocument(db: DbOrTx, company: Company, sourceId: string, kind: DocumentKind, today: string): Promise<DocumentDraft | null> {
  const [src] = await db.select().from(documents).where(and(eq(documents.id, sourceId), eq(documents.companyId, company.id))).limit(1);
  if (!src) return null;
  if (kind === "rectifying" && src.kind !== "invoice") return null;
  const items = await db.select().from(documentItems).where(eq(documentItems.documentId, src.id)).orderBy(asc(documentItems.sortOrder));
  const negate = kind === "rectifying";
  const draft = emptyDraft(company, kind, today < src.issueDate && negate ? src.issueDate : today);
  const c = src.customer;
  return {
    ...draft,
    orderId: src.orderId ?? "",
    customerId: src.customerId ?? "",
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
    rectifiesId: negate ? src.id : "",
    rectifiesNumber: negate ? src.number : undefined,
    pricesIncludeVat: src.pricesIncludeVat,
    showPrices: src.showPrices,
    vatRatePct: numberToInput(src.vatRatePct),
    irpfRatePct: kind === "delivery_note" || kind === "quote" ? "0" : numberToInput(src.irpfRatePct),
    // En una rectificativa el descuento y el envío van como líneas negativas.
    discount: !negate && src.discountCents ? centsToInput(src.discountCents) : "",
    shipping: !negate && src.shippingCents ? centsToInput(src.shippingCents) : "",
    paymentMethod: src.paymentMethod ?? "",
    notes: src.kind === kind ? (src.notes ?? "") : `Según ${DOCUMENT_KIND_LABELS[src.kind].toLowerCase()} ${src.number}`,
    terms: kind === "quote" ? (src.terms ?? draft.terms) : "",
    items: [
      ...items.map((i) => ({
        productId: i.productId ?? "",
        description: i.description,
        quantity: numberToInput(negate ? -i.quantity : i.quantity),
        unitPrice: centsToInput(i.unitPriceCents),
      })),
      ...(negate && src.shippingCents ? [{ productId: "", description: "Gastos de envío", quantity: "-1", unitPrice: centsToInput(src.shippingCents) }] : []),
      ...(negate && src.discountCents ? [{ productId: "", description: "Descuento", quantity: "1", unitPrice: centsToInput(src.discountCents) }] : []),
    ],
  };
}
