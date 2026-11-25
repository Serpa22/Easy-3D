import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { orderItems, orders, products, transactions } from "@/server/db/schema";
import { nextOrderNumber } from "@/server/domain/companies";
import { computeOrderTotals, removeOrderEffects, restoreOrderStock, syncOrderEffects } from "@/server/domain/orders";
import { freshDb, makeCompany } from "../helpers/db";

async function setup() {
  const db = await getDb();
  const company = await makeCompany("Teclas");
  const [product] = await db
    .insert(products)
    .values({ companyId: company.id, name: "Set de teclas", priceCents: 2500, stockQty: 10 })
    .returning();
  const number = await nextOrderNumber(db, company.id);
  const items = [{ quantity: 2, unitPriceCents: 2500 }];
  const totals = computeOrderTotals({ items, discountCents: 500, shippingChargedCents: 450 });
  const [order] = await db
    .insert(orders)
    .values({
      companyId: company.id,
      number,
      customerName: "Lucía Fernández",
      orderDate: "2026-11-20",
      channel: "etsy",
      discountCents: 500,
      shippingChargedCents: 450,
      feesCents: 320,
      ...totals,
    })
    .returning();
  await db.insert(orderItems).values({ orderId: order.id, productId: product.id, description: product.name, quantity: 2, unitPriceCents: 2500, totalCents: 5000 });
  return { db, company, product, order };
}

beforeEach(async () => {
  await freshDb();
});

describe("pedidos", () => {
  it("calcula totales", () => {
    expect(computeOrderTotals({ items: [{ quantity: 2, unitPriceCents: 2500 }], discountCents: 500, shippingChargedCents: 450 })).toEqual({
      subtotalCents: 5000,
      totalCents: 4950,
    });
    expect(computeOrderTotals({ items: [], discountCents: 500 })).toEqual({ subtotalCents: 0, totalCents: 0 });
  });

  it("sin cobrar no genera movimientos; al cobrar crea ingreso y comisión", async () => {
    const { db, company, order } = await setup();
    await syncOrderEffects(db, company.id, order.id);
    expect(await db.select().from(transactions)).toHaveLength(0);

    await db.update(orders).set({ paymentStatus: "paid", paidAt: "2026-11-21", paymentMethod: "platform" }).where(eq(orders.id, order.id));
    await syncOrderEffects(db, company.id, order.id);
    await syncOrderEffects(db, company.id, order.id); // idempotente
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(2);
    const income = rows.find((r) => r.type === "income")!;
    const fee = rows.find((r) => r.type === "expense")!;
    expect(income).toMatchObject({ category: "sales", amountCents: 4950, date: "2026-11-21", sourceType: "order", counterparty: "Lucía Fernández" });
    expect(fee).toMatchObject({ category: "platform_fees", amountCents: 320, sourceType: "order_fee" });
  });

  it("un reembolso retira el ingreso y la comisión", async () => {
    const { db, company, order } = await setup();
    await db.update(orders).set({ paymentStatus: "paid", paidAt: "2026-11-21" }).where(eq(orders.id, order.id));
    await syncOrderEffects(db, company.id, order.id);
    await db.update(orders).set({ paymentStatus: "refunded" }).where(eq(orders.id, order.id));
    await syncOrderEffects(db, company.id, order.id);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  it("descuenta stock una sola vez al enviar y lo devuelve al cancelar", async () => {
    const { db, company, product, order } = await setup();
    const stock = async () => (await db.select().from(products).where(eq(products.id, product.id)))[0].stockQty;

    await syncOrderEffects(db, company.id, order.id);
    expect(await stock()).toBe(10);

    await db.update(orders).set({ status: "shipped" }).where(eq(orders.id, order.id));
    await syncOrderEffects(db, company.id, order.id);
    await syncOrderEffects(db, company.id, order.id);
    expect(await stock()).toBe(8);

    await db.update(orders).set({ status: "delivered" }).where(eq(orders.id, order.id));
    await syncOrderEffects(db, company.id, order.id);
    expect(await stock()).toBe(8);

    await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, order.id));
    await syncOrderEffects(db, company.id, order.id);
    expect(await stock()).toBe(10);
  });

  it("si no hay stock suficiente descuenta lo que hay y al cancelar devuelve exactamente eso", async () => {
    const { db, company, product, order } = await setup();
    const stock = async () => (await db.select().from(products).where(eq(products.id, product.id)))[0].stockQty;
    await db.update(products).set({ stockQty: 1 }).where(eq(products.id, product.id));

    await db.update(orders).set({ status: "shipped" }).where(eq(orders.id, order.id));
    await syncOrderEffects(db, company.id, order.id);
    expect(await stock()).toBe(0); // pedía 2 y solo había 1
    expect((await db.select().from(orderItems).where(eq(orderItems.orderId, order.id)))[0].stockDeductedQty).toBe(1);

    await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, order.id));
    await syncOrderEffects(db, company.id, order.id);
    expect(await stock()).toBe(1); // antes volvía a 2: una unidad fantasma
    expect((await db.select().from(orderItems).where(eq(orderItems.orderId, order.id)))[0].stockDeductedQty).toBe(0);
  });

  it("permite cambiar las líneas de un pedido enviado sin descuadrar el stock", async () => {
    const { db, company, product, order } = await setup();
    const stock = async () => (await db.select().from(products).where(eq(products.id, product.id)))[0].stockQty;
    await db.update(orders).set({ status: "shipped" }).where(eq(orders.id, order.id));
    await syncOrderEffects(db, company.id, order.id);
    expect(await stock()).toBe(8);

    await db.transaction(async (tx) => {
      await restoreOrderStock(tx, company.id, order.id);
      await tx.update(orderItems).set({ quantity: 5, totalCents: 12500 }).where(eq(orderItems.orderId, order.id));
      await syncOrderEffects(tx, company.id, order.id);
    });
    expect(await stock()).toBe(5);
  });

  it("borrar un pedido deshace ingreso, comisión y stock; y no cruza empresas", async () => {
    const { db, company, product, order } = await setup();
    const other = await makeCompany("Figuras");
    await db.update(orders).set({ status: "shipped", paymentStatus: "paid", paidAt: "2026-11-21" }).where(eq(orders.id, order.id));
    await syncOrderEffects(db, company.id, order.id);
    await expect(syncOrderEffects(db, other.id, order.id)).rejects.toThrow("El pedido no existe");
    await expect(removeOrderEffects(db, other.id, order.id)).rejects.toThrow("El pedido no existe");

    await db.transaction(async (tx) => {
      await removeOrderEffects(tx, company.id, order.id);
      await tx.delete(orders).where(eq(orders.id, order.id));
    });
    expect(await db.select().from(transactions)).toHaveLength(0);
    expect((await db.select().from(products).where(eq(products.id, product.id)))[0].stockQty).toBe(10);
  });
});
