import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { documentItems, documents, orderItems, orders } from "@/server/db/schema";
import { computeDocumentTotals, formatDocumentNumber } from "@/lib/documents";
import { nextOrderNumber } from "@/server/domain/companies";
import { deleteDocument, documentInputSchema, draftFromDocument, draftFromOrder, saveDocument, setQuoteStatus } from "@/server/domain/documents-service";
import { freshDb, makeCompany } from "../helpers/db";

beforeEach(async () => {
  await freshDb();
});

function input(patch: Record<string, unknown> = {}) {
  return documentInputSchema.parse({
    kind: "invoice",
    issueDate: "2026-11-20",
    customer: { name: "Talleres Ruiz S.L.", taxId: "B12345678" },
    vatRatePct: "21",
    irpfRatePct: "0",
    items: [{ description: "Diseño 3D", quantity: "2,5", unitPrice: "40" }],
    ...patch,
  });
}

describe("totales de documentos", () => {
  it("precios sin IVA: base, IVA, retención y total a pagar", () => {
    const t = computeDocumentTotals({ lines: [{ quantity: 2.5, unitPriceCents: 4000 }, { quantity: 1, unitPriceCents: 1999 }], discountCents: 0, shippingCents: 500, vatRatePct: 21, irpfRatePct: 15, pricesIncludeVat: false });
    expect(t.subtotalCents).toBe(11999);
    expect(t.baseCents).toBe(12499);
    expect(t.vatCents).toBe(2625); // 2624,79
    expect(t.totalCents).toBe(15124);
    expect(t.irpfCents).toBe(1875); // 1874,85
    expect(t.amountDueCents).toBe(13249);
  });

  it("precios con IVA incluido: el total cuadra al céntimo con el pedido", () => {
    const t = computeDocumentTotals({ lines: [{ quantity: 2, unitPriceCents: 2500 }], discountCents: 500, shippingCents: 450, vatRatePct: 21, irpfRatePct: 0, pricesIncludeVat: true });
    expect(t.totalCents).toBe(4950);
    expect(t.baseCents + t.vatCents).toBe(4950);
    expect(t.baseCents).toBe(4091);
  });

  it("negativos simétricos (rectificativas)", () => {
    const pos = computeDocumentTotals({ lines: [{ quantity: 3, unitPriceCents: 1235 }], discountCents: 0, shippingCents: 0, vatRatePct: 21, irpfRatePct: 15, pricesIncludeVat: false });
    const neg = computeDocumentTotals({ lines: [{ quantity: -3, unitPriceCents: 1235 }], discountCents: 0, shippingCents: 0, vatRatePct: 21, irpfRatePct: 15, pricesIncludeVat: false });
    expect(neg.totalCents).toBe(-pos.totalCents);
    expect(neg.vatCents).toBe(-pos.vatCents);
    expect(neg.amountDueCents).toBe(-pos.amountDueCents);
  });

  it("formatea el número", () => {
    expect(formatDocumentNumber("F", 2026, 7)).toBe("F2026-0007");
  });
});

describe("documentos", () => {
  it("numera de forma correlativa por tipo y año", async () => {
    const db = await getDb();
    const company = await makeCompany("Teclas", { taxId: "12345678Z", fiscalCity: "Madrid" });
    const a = await saveDocument(db, company, input());
    const b = await saveDocument(db, company, input({ issueDate: "2026-11-21" }));
    const q = await saveDocument(db, company, input({ kind: "quote" }));
    const next = await saveDocument(db, company, input({ issueDate: "2027-01-02" }));
    expect([a.number, b.number, q.number, next.number]).toEqual(["F2026-0001", "F2026-0002", "PRE2026-0001", "F2027-0001"]);
    const [row] = await db.select().from(documents).where(eq(documents.id, a.id));
    expect(row.issuer.taxId).toBe("12345678Z");
    expect(row.totalCents).toBe(12100);
  });

  it("no deja romper el orden de fechas de una serie de facturas", async () => {
    const db = await getDb();
    const company = await makeCompany();
    await saveDocument(db, company, input({ issueDate: "2026-11-20" }));
    await expect(saveDocument(db, company, input({ issueDate: "2026-11-10" }))).rejects.toThrow(/orden/);
    // Los presupuestos no tienen esa restricción.
    await expect(saveDocument(db, company, input({ kind: "quote", issueDate: "2026-11-10" }))).resolves.toBeTruthy();
  });

  it("solo borra la última factura y libera su número", async () => {
    const db = await getDb();
    const company = await makeCompany();
    const a = await saveDocument(db, company, input());
    const b = await saveDocument(db, company, input());
    await expect(deleteDocument(db, company.id, a.id)).rejects.toThrow(/última/);
    await deleteDocument(db, company.id, b.id);
    const c = await saveDocument(db, company, input());
    expect(c.number).toBe("F2026-0002");
    expect(await db.select().from(documentItems).where(eq(documentItems.documentId, b.id))).toHaveLength(0);
  });

  it("rectificativa: exige factura y motivo, admite negativos y bloquea el borrado de la original", async () => {
    const db = await getDb();
    const company = await makeCompany();
    const inv = await saveDocument(db, company, input());
    await expect(saveDocument(db, company, input({ kind: "rectifying" }))).rejects.toThrow(/Revisa/);
    // Las facturas normales no admiten cantidades negativas.
    await expect(saveDocument(db, company, input({ items: [{ description: "x", quantity: "-1", unitPrice: "10" }] }))).rejects.toThrow(/Revisa/);

    const draft = await draftFromDocument(db, company, inv.id, "rectifying", "2026-11-25");
    expect(draft?.items[0].quantity).toBe("-2,5");
    const rect = await saveDocument(
      db,
      company,
      input({ kind: "rectifying", issueDate: "2026-11-25", rectifiesId: inv.id, rectificationReason: "Error en el precio", items: draft!.items }),
    );
    expect(rect.number).toBe("R2026-0001");
    const [row] = await db.select().from(documents).where(eq(documents.id, rect.id));
    expect(row.totalCents).toBe(-12100);
    // La factura rectificada es la última de su serie, pero ya no se puede borrar.
    await expect(deleteDocument(db, company.id, inv.id)).rejects.toThrow(/rectifica/);
  });

  it("borrador desde un pedido con IVA incluido", async () => {
    const db = await getDb();
    const company = await makeCompany();
    const number = await nextOrderNumber(db, company.id);
    const [order] = await db
      .insert(orders)
      .values({ companyId: company.id, number, customerName: "Lucía Fernández", orderDate: "2026-11-20", discountCents: 500, shippingChargedCents: 450, subtotalCents: 5000, totalCents: 4950, shipCity: "Sevilla" })
      .returning();
    await db.insert(orderItems).values({ orderId: order.id, description: "Set de teclas", quantity: 2, unitPriceCents: 2500, totalCents: 5000 });
    const draft = await draftFromOrder(db, company, order.id, "invoice", "2026-11-26");
    expect(draft).toMatchObject({ pricesIncludeVat: true, orderId: order.id, discount: "5,00", shipping: "4,50" });
    expect(draft?.customer.city).toBe("Sevilla");
    const saved = await saveDocument(db, company, input({ ...draft, issueDate: "2026-11-26" }));
    const [row] = await db.select().from(documents).where(eq(documents.id, saved.id));
    expect(row.totalCents).toBe(4950);
  });

  it("aísla por empresa", async () => {
    const db = await getDb();
    const a = await makeCompany("Teclas");
    const b = await makeCompany("Figuras");
    const doc = await saveDocument(db, a, input({ kind: "quote" }));
    await expect(deleteDocument(db, b.id, doc.id)).rejects.toThrow(/no existe/);
    await expect(setQuoteStatus(db, b.id, doc.id, "accepted")).rejects.toThrow(/no existe/);
    await expect(saveDocument(db, b, input({ id: doc.id, kind: "quote" }))).rejects.toThrow(/no existe/);
    await expect(saveDocument(db, b, input({ kind: "rectifying", rectifiesId: doc.id, rectificationReason: "x" }))).rejects.toThrow(/no existe/);
    expect(await draftFromDocument(db, b, doc.id, "invoice", "2026-11-26")).toBeNull();
    await setQuoteStatus(db, a.id, doc.id, "accepted");
    const [row] = await db.select().from(documents).where(eq(documents.id, doc.id));
    expect(row.status).toBe("accepted");
  });
});
