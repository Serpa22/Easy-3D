import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { companies, materials, materialMovements, transactions } from "@/server/db/schema";
import { removeLedgerEntriesFor, removeLedgerEntry, syncLedgerEntry } from "@/server/domain/ledger";
import { applyMaterialMovement, materialCostCents, revertMaterialMovement } from "@/server/domain/stock";
import { createCompany, defaultMonogram, defaultOrderPrefix, nextOrderNumber, slugify } from "@/server/domain/companies";
import { freshDb, makeCompany } from "../helpers/db";

beforeEach(async () => {
  await freshDb();
});

describe("empresas", () => {
  it("genera slugs únicos y legibles", async () => {
    const db = await getDb();
    expect(slugify("Teclas Artesanas 3D")).toBe("teclas-artesanas-3d");
    expect(slugify("  Ñandú & Cía.  ")).toBe("nandu-cia");
    expect(slugify("!!!")).toBe("empresa");
    const a = await createCompany(db, { name: "Teclas" });
    const b = await createCompany(db, { name: "Teclas" });
    const c = await createCompany(db, { name: "Nueva" });
    expect(a.slug).toBe("teclas");
    expect(b.slug).toBe("teclas-2");
    expect(c.slug).toBe("nueva-3d"); // «nueva» está reservado por la ruta de alta
    expect(b.sortOrder).toBe(a.sortOrder + 1);
    expect(defaultMonogram("Teclas Pro")).toBe("TP");
    expect(defaultMonogram("Figuras")).toBe("FI");
    expect(defaultOrderPrefix("Teclas")).toBe("TEC");
  });
  it("numera pedidos de forma correlativa por empresa", async () => {
    const db = await getDb();
    const a = await makeCompany("Teclas");
    const b = await makeCompany("Figuras");
    expect(await nextOrderNumber(db, a.id)).toBe("TEC-0001");
    expect(await nextOrderNumber(db, a.id)).toBe("TEC-0002");
    expect(await nextOrderNumber(db, b.id)).toBe("FIG-0001");
  });
});

describe("libro contable derivado", () => {
  it("crea, actualiza y elimina sin duplicar", async () => {
    const db = await getDb();
    const company = await makeCompany();
    const sourceId = crypto.randomUUID();
    const entry = {
      companyId: company.id,
      sourceType: "order" as const,
      sourceId,
      type: "income" as const,
      category: "sales" as const,
      amountCents: 2500,
      date: "2026-11-25",
      description: "Pedido TEC-0001",
    };
    await syncLedgerEntry(db, entry);
    await syncLedgerEntry(db, entry);
    let rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(2500);

    await syncLedgerEntry(db, { ...entry, amountCents: 3000, date: "2026-11-26" });
    rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(3000);
    expect(rows[0].date).toBe("2026-11-26");

    // Otro tipo de origen para el mismo registro convive (comisión del pedido).
    await syncLedgerEntry(db, { ...entry, sourceType: "order_fee", type: "expense", category: "platform_fees", amountCents: 200 });
    expect(await db.select().from(transactions)).toHaveLength(2);

    // Importe 0 → se elimina.
    await syncLedgerEntry(db, { ...entry, amountCents: 0 });
    rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceType).toBe("order_fee");

    await removeLedgerEntry(db, { companyId: company.id, sourceType: "order_fee", sourceId });
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  it("distingue periodos con sourceKey y no toca movimientos manuales ni de otra empresa", async () => {
    const db = await getDb();
    const a = await makeCompany("Teclas");
    const b = await makeCompany("Figuras");
    const sourceId = crypto.randomUUID();
    const base = {
      sourceType: "recurring" as const,
      sourceId,
      type: "expense" as const,
      category: "software" as const,
      amountCents: 999,
      description: "Suscripción slicer",
    };
    await syncLedgerEntry(db, { ...base, companyId: a.id, sourceKey: "2026-10-01", date: "2026-10-01" });
    await syncLedgerEntry(db, { ...base, companyId: a.id, sourceKey: "2026-11-01", date: "2026-11-01" });
    await syncLedgerEntry(db, { ...base, companyId: a.id, sourceKey: "2026-11-01", date: "2026-11-01" });
    await db.insert(transactions).values({
      companyId: a.id,
      type: "expense",
      category: "other_expense",
      amountCents: 100,
      date: "2026-11-01",
      description: "Manual",
      sourceId,
    });
    expect(await db.select().from(transactions)).toHaveLength(3);

    // Borrar «todo lo derivado» desde otra empresa no afecta.
    await removeLedgerEntriesFor(db, b.id, sourceId);
    expect(await db.select().from(transactions)).toHaveLength(3);

    await removeLedgerEntriesFor(db, a.id, sourceId);
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceType).toBe("manual");
  });
});

describe("stock de material", () => {
  async function makeMaterial(companyId: string) {
    const db = await getDb();
    const [m] = await db
      .insert(materials)
      .values({ companyId, name: "PLA negro", unit: "g", stockQty: 500, packSize: 1000, packCostCents: 2000, supplier: "Filamentos SL" })
      .returning();
    return m;
  }

  it("una compra suma stock, actualiza el precio del envase y genera un gasto", async () => {
    const db = await getDb();
    const company = await makeCompany();
    const m = await makeMaterial(company.id);
    await db.transaction(async (tx) => {
      await applyMaterialMovement(tx, {
        companyId: company.id,
        materialId: m.id,
        type: "purchase",
        qty: 2000,
        totalCostCents: 3600,
        date: "2026-11-20",
      });
    });
    const [after] = await db.select().from(materials).where(eq(materials.id, m.id));
    expect(after.stockQty).toBe(2500);
    expect(after.packCostCents).toBe(1800); // 36 € por 2 kg → 18 €/bobina
    const tx = await db.select().from(transactions);
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ type: "expense", category: "materials", amountCents: 3600, counterparty: "Filamentos SL", sourceType: "material_purchase" });
  });

  it("consumo y merma restan (sin bajar de cero) y no generan gasto", async () => {
    const db = await getDb();
    const company = await makeCompany();
    const m = await makeMaterial(company.id);
    await applyMaterialMovement(db, { companyId: company.id, materialId: m.id, type: "consumption", qty: 120, date: "2026-11-21" });
    await applyMaterialMovement(db, { companyId: company.id, materialId: m.id, type: "waste", qty: -30, date: "2026-11-21" });
    let [after] = await db.select().from(materials).where(eq(materials.id, m.id));
    expect(after.stockQty).toBe(350);
    await applyMaterialMovement(db, { companyId: company.id, materialId: m.id, type: "consumption", qty: 9999, date: "2026-11-22" });
    [after] = await db.select().from(materials).where(eq(materials.id, m.id));
    expect(after.stockQty).toBe(0);
    expect(await db.select().from(transactions)).toHaveLength(0);
    expect(materialCostCents(m, 120)).toBe(240);
  });

  it("revertir una compra devuelve el stock y borra su gasto", async () => {
    const db = await getDb();
    const company = await makeCompany();
    const m = await makeMaterial(company.id);
    const { movementId } = await applyMaterialMovement(db, {
      companyId: company.id,
      materialId: m.id,
      type: "purchase",
      qty: 1000,
      totalCostCents: 2000,
      date: "2026-11-20",
    });
    await revertMaterialMovement(db, company.id, movementId);
    const [after] = await db.select().from(materials).where(eq(materials.id, m.id));
    expect(after.stockQty).toBe(500);
    expect(await db.select().from(transactions)).toHaveLength(0);
    expect(await db.select().from(materialMovements)).toHaveLength(0);
  });

  it("no permite tocar material de otra empresa", async () => {
    const a = await makeCompany("Teclas");
    const b = await makeCompany("Figuras");
    const db = await getDb();
    const m = await makeMaterial(a.id);
    await expect(
      applyMaterialMovement(db, { companyId: b.id, materialId: m.id, type: "consumption", qty: 10, date: "2026-11-21" }),
    ).rejects.toThrow("El material no existe");
    expect((await db.select().from(companies)).length).toBe(2);
  });
});
