/**
 * Operaciones de pedidos como funciones puras de (db, empresa, datos): las
 * Server Actions son envoltorios finos y estas se prueban directamente.
 */
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db";
import { customers, orderItems, orders, products, type Company } from "@/server/db/schema";
import { ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES, SALES_CHANNELS, type OrderStatus } from "@/lib/domain";
import { zCents, zDate, zInt, zOptionalCents, zOptionalDate, zOptionalId, zOptionalText, zText } from "@/lib/validation";
import { ActionError } from "@/server/action";
import { nextOrderNumber } from "./companies";
import { computeOrderTotals, removeOrderEffects, restoreOrderStock, syncOrderEffects } from "./orders";

export const orderInputSchema = z.object({
  id: zOptionalId(),
  customerId: zOptionalId(),
  customerName: zText(120),
  saveCustomer: z.boolean().optional().default(false),
  customerEmail: zOptionalText(160),
  customerPhone: zOptionalText(40),
  channel: z.enum(SALES_CHANNELS),
  status: z.enum(ORDER_STATUSES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  paymentMethod: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.enum(PAYMENT_METHODS).optional()),
  orderDate: zDate(),
  dueDate: zOptionalDate(),
  paidAt: zOptionalDate(),
  discount: zOptionalCents(0),
  shippingCharged: zOptionalCents(0),
  fees: zOptionalCents(0),
  shipName: zOptionalText(120),
  shipAddressLine: zOptionalText(200),
  shipPostalCode: zOptionalText(20),
  shipCity: zOptionalText(80),
  shipProvince: zOptionalText(80),
  shipCountry: zOptionalText(80),
  notes: zOptionalText(2000),
  items: z
    .array(
      z.object({
        productId: zOptionalId(),
        description: zText(200),
        quantity: zInt({ min: 1, max: 100000 }),
        unitPrice: zCents(),
      }),
    )
    .min(1, "Añade al menos una línea")
    .max(100),
});
export type OrderInput = z.output<typeof orderInputSchema>;

/** Crea o edita un pedido completo (cabecera + líneas) y sincroniza finanzas y stock. */
export async function saveOrder(db: Db, company: Company, input: OrderInput, today: string): Promise<{ id: string; number: string }> {
  return db.transaction(async (tx) => {
    // Los productos y el cliente deben ser de esta empresa.
    const productIds = [...new Set(input.items.map((i) => i.productId).filter((id): id is string => Boolean(id)))];
    if (productIds.length > 0) {
      const found = await tx.select({ id: products.id }).from(products).where(and(eq(products.companyId, company.id), inArray(products.id, productIds)));
      if (found.length !== productIds.length) throw new ActionError("Alguno de los productos ya no existe.");
    }
    let customerId = input.customerId;
    if (customerId) {
      const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.companyId, company.id))).limit(1);
      if (!c) throw new ActionError("El cliente ya no existe.");
    } else if (input.saveCustomer) {
      const [c] = await tx
        .insert(customers)
        .values({
          companyId: company.id,
          name: input.customerName,
          email: input.customerEmail,
          phone: input.customerPhone,
          addressLine: input.shipAddressLine,
          postalCode: input.shipPostalCode,
          city: input.shipCity,
          province: input.shipProvince,
          country: input.shipCountry ?? "España",
        })
        .returning({ id: customers.id });
      customerId = c.id;
    }

    const items = input.items.map((i) => ({ quantity: i.quantity, unitPriceCents: i.unitPrice }));
    const totals = computeOrderTotals({ items, discountCents: input.discount ?? 0, shippingChargedCents: input.shippingCharged ?? 0 });
    if ((input.discount ?? 0) > totals.subtotalCents + (input.shippingCharged ?? 0)) throw new ActionError("Revisa los importes.", { discount: "El descuento supera el importe del pedido" });
    const paid = input.paymentStatus === "paid";
    const values = {
      customerId,
      customerName: input.customerName,
      channel: input.channel,
      status: input.status,
      paymentStatus: input.paymentStatus,
      paymentMethod: input.paymentMethod ?? null,
      orderDate: input.orderDate,
      dueDate: input.dueDate,
      paidAt: paid ? (input.paidAt ?? today) : null,
      discountCents: input.discount ?? 0,
      shippingChargedCents: input.shippingCharged ?? 0,
      feesCents: input.fees ?? 0,
      ...totals,
      shipName: input.shipName ?? input.customerName,
      shipAddressLine: input.shipAddressLine,
      shipPostalCode: input.shipPostalCode,
      shipCity: input.shipCity,
      shipProvince: input.shipProvince,
      shipCountry: input.shipCountry,
      notes: input.notes,
    };

    let orderId: string;
    let number: string;
    if (input.id) {
      const [existing] = await tx.select({ id: orders.id, number: orders.number }).from(orders).where(and(eq(orders.id, input.id), eq(orders.companyId, company.id))).limit(1);
      if (!existing) throw new ActionError("El pedido ya no existe.");
      await restoreOrderStock(tx, company.id, existing.id);
      await tx.delete(orderItems).where(eq(orderItems.orderId, existing.id));
      await tx.update(orders).set(values).where(eq(orders.id, existing.id));
      orderId = existing.id;
      number = existing.number;
    } else {
      number = await nextOrderNumber(tx, company.id);
      const [row] = await tx.insert(orders).values({ ...values, companyId: company.id, number, vatRatePct: company.vatRatePct }).returning({ id: orders.id });
      orderId = row.id;
    }
    await tx.insert(orderItems).values(
      input.items.map((item, index) => ({
        orderId,
        productId: item.productId,
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unitPrice,
        totalCents: item.quantity * item.unitPrice,
        sortOrder: index,
      })),
    );
    await syncOrderEffects(tx, company.id, orderId);
    return { id: orderId, number };
  });
}

/** Cambia el estado y/o el cobro de un pedido y sincroniza sus efectos. */
export async function updateOrderState(
  db: Db,
  companyId: string,
  orderId: string,
  patch: { status?: OrderStatus; paid?: boolean },
  today: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.companyId, companyId))).limit(1);
    if (!order) throw new ActionError("El pedido ya no existe.");
    const set: Partial<typeof orders.$inferInsert> = {};
    if (patch.status) set.status = patch.status;
    if (patch.paid === true && order.paymentStatus !== "paid") {
      set.paymentStatus = "paid";
      set.paidAt = today;
    } else if (patch.paid === false && order.paymentStatus === "paid") {
      set.paymentStatus = "unpaid";
      set.paidAt = null;
    }
    if (Object.keys(set).length > 0) await tx.update(orders).set(set).where(eq(orders.id, order.id));
    await syncOrderEffects(tx, companyId, order.id);
  });
}

export async function deleteOrder(db: Db, companyId: string, orderId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await removeOrderEffects(tx, companyId, orderId); // lanza si no existe o es de otra empresa
    await tx.delete(orders).where(and(eq(orders.id, orderId), eq(orders.companyId, companyId)));
  });
}
