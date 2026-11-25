/**
 * Efectos de un pedido en finanzas y en el stock de producto terminado.
 * Llamar a `syncOrderEffects` dentro de la misma transacción cada vez que se
 * crea o modifica un pedido, y a `removeOrderEffects` antes de borrarlo.
 */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { orderItems, orders, products, type Order } from "@/server/db/schema";
import type { OrderStatus } from "@/lib/domain";
import { ActionError } from "@/server/action";
import { removeLedgerEntriesFor, syncLedgerEntry } from "./ledger";

/** Estados en los que la mercancía ya ha salido del almacén. */
const STOCK_OUT_STATUSES: readonly OrderStatus[] = ["shipped", "delivered"];

/** Totales de un pedido a partir de sus líneas. Todo en céntimos, IVA incluido. */
export function computeOrderTotals(input: {
  items: Array<{ quantity: number; unitPriceCents: number }>;
  discountCents?: number;
  shippingChargedCents?: number;
}): { subtotalCents: number; totalCents: number } {
  const subtotalCents = input.items.reduce((acc, item) => acc + Math.round(item.quantity) * Math.round(item.unitPriceCents), 0);
  const totalCents = Math.max(0, subtotalCents - (input.discountCents ?? 0) + (input.shippingChargedCents ?? 0));
  return { subtotalCents, totalCents };
}

async function loadOrder(tx: DbOrTx, companyId: string, orderId: string): Promise<Order> {
  const [order] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.companyId, companyId)))
    .limit(1);
  if (!order) throw new ActionError("El pedido no existe.");
  return order;
}

/**
 * Descuenta del stock de producto las unidades del pedido. El stock nunca baja
 * de 0 (hay quien fabrica bajo pedido y no lleva stock), así que cada línea
 * apunta cuántas unidades ha descontado de verdad.
 */
async function deductStock(tx: DbOrTx, order: Order): Promise<void> {
  const items = await tx
    .select({ id: orderItems.id, productId: orderItems.productId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));
  for (const item of items) {
    if (!item.productId || item.quantity <= 0) continue;
    const [product] = await tx
      .select({ stockQty: products.stockQty })
      .from(products)
      .where(and(eq(products.id, item.productId), eq(products.companyId, order.companyId)))
      .for("update")
      .limit(1);
    if (!product) continue;
    const deducted = Math.min(item.quantity, Math.max(0, product.stockQty));
    if (deducted <= 0) continue;
    await tx
      .update(products)
      .set({ stockQty: sql`${products.stockQty} - ${deducted}` })
      .where(and(eq(products.id, item.productId), eq(products.companyId, order.companyId)));
    await tx.update(orderItems).set({ stockDeductedQty: deducted }).where(eq(orderItems.id, item.id));
  }
}

/** Devuelve al stock exactamente lo que cada línea descontó (ni más ni menos). */
async function returnStock(tx: DbOrTx, order: Order): Promise<void> {
  const items = await tx
    .select({ id: orderItems.id, productId: orderItems.productId, deducted: orderItems.stockDeductedQty })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));
  for (const item of items) {
    if (item.deducted <= 0) continue;
    if (item.productId) {
      await tx
        .update(products)
        .set({ stockQty: sql`${products.stockQty} + ${item.deducted}` })
        .where(and(eq(products.id, item.productId), eq(products.companyId, order.companyId)));
    }
    await tx.update(orderItems).set({ stockDeductedQty: 0 }).where(eq(orderItems.id, item.id));
  }
}

/**
 * Devuelve al stock las unidades de un pedido si ya se habían descontado.
 * Llamar ANTES de cambiar las líneas de un pedido.
 */
export async function restoreOrderStock(tx: DbOrTx, companyId: string, orderId: string): Promise<void> {
  const order = await loadOrder(tx, companyId, orderId);
  if (!order.stockDeducted) return;
  await returnStock(tx, order);
  await tx.update(orders).set({ stockDeducted: false }).where(eq(orders.id, order.id));
}

/**
 * Sincroniza finanzas y stock con el estado actual del pedido:
 *  - cobrado            → ingreso «Ventas» por el total (fecha de cobro);
 *                         y gasto «Comisiones de plataforma» si hay comisiones.
 *  - sin cobrar / reembolsado → sin movimientos.
 *  - enviado / entregado → descuenta las unidades del stock de producto (una sola vez).
 *  - cualquier otro estado → devuelve las unidades si se habían descontado.
 */
export async function syncOrderEffects(tx: DbOrTx, companyId: string, orderId: string): Promise<void> {
  const order = await loadOrder(tx, companyId, orderId);
  const paid = order.paymentStatus === "paid";
  const date = order.paidAt ?? order.orderDate;

  await syncLedgerEntry(tx, {
    companyId,
    sourceType: "order",
    sourceId: order.id,
    type: "income",
    category: "sales",
    amountCents: paid ? order.totalCents : 0,
    vatRatePct: order.vatRatePct,
    date,
    description: `Pedido ${order.number} · ${order.customerName}`,
    counterparty: order.customerName,
    paymentMethod: order.paymentMethod,
  });
  await syncLedgerEntry(tx, {
    companyId,
    sourceType: "order_fee",
    sourceId: order.id,
    type: "expense",
    category: "platform_fees",
    amountCents: paid ? order.feesCents : 0,
    vatRatePct: 0,
    date,
    description: `Comisiones del pedido ${order.number}`,
    paymentMethod: order.paymentMethod,
  });

  const shouldDeduct = STOCK_OUT_STATUSES.includes(order.status);
  if (shouldDeduct && !order.stockDeducted) {
    await deductStock(tx, order);
    await tx.update(orders).set({ stockDeducted: true }).where(eq(orders.id, order.id));
  } else if (!shouldDeduct && order.stockDeducted) {
    await returnStock(tx, order);
    await tx.update(orders).set({ stockDeducted: false }).where(eq(orders.id, order.id));
  }
}

/** Deshace todo efecto del pedido (antes de borrarlo). */
export async function removeOrderEffects(tx: DbOrTx, companyId: string, orderId: string): Promise<void> {
  await restoreOrderStock(tx, companyId, orderId);
  await removeLedgerEntriesFor(tx, companyId, orderId, ["order", "order_fee"]);
}
