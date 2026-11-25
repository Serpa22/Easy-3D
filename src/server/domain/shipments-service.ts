/** Operaciones de envíos como funciones de (db, empresa, datos), probables sin sesión. */
import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db, Tx } from "@/server/db";
import { orders, shipments, type Shipment } from "@/server/db/schema";
import { trackingUrlFor } from "@/lib/carriers";
import { SHIPMENT_STATUSES, type OrderStatus, type ShipmentStatus } from "@/lib/domain";
import { zOptionalCents, zOptionalDate, zOptionalId, zOptionalInt, zOptionalText, zText } from "@/lib/validation";
import { ActionError } from "@/server/action";
import { removeShipmentExpense, syncShipmentExpense } from "./derived-expenses";
import { syncOrderEffects } from "./orders";

export const shipmentInputSchema = z
  .object({
    id: zOptionalId(),
    orderId: zOptionalId(),
    carrier: zText(60),
    service: zOptionalText(80),
    trackingNumber: zOptionalText(80),
    trackingUrl: zOptionalText(500),
    status: z.enum(SHIPMENT_STATUSES),
    cost: zOptionalCents(0),
    weightG: zOptionalInt(null, { min: 0, max: 1_000_000 }),
    recipientName: zOptionalText(120),
    destination: zOptionalText(160),
    shippedAt: zOptionalDate(),
    estimatedDelivery: zOptionalDate(),
    deliveredAt: zOptionalDate(),
    notes: zOptionalText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.trackingUrl && !/^https?:\/\//i.test(v.trackingUrl)) ctx.addIssue({ code: "custom", path: ["trackingUrl"], message: "Debe empezar por http:// o https://" });
    if (v.shippedAt && v.deliveredAt && v.deliveredAt < v.shippedAt) ctx.addIssue({ code: "custom", path: ["deliveredAt"], message: "No puede ser anterior al envío" });
  });
export type ShipmentInput = z.output<typeof shipmentInputSchema>;

const ORDER_RANK: Record<OrderStatus, number> = { pending: 0, in_production: 1, ready: 2, shipped: 3, delivered: 4, returned: 5, cancelled: 9 };

/**
 * El pedido sigue al envío, siempre hacia delante: etiqueta/en tránsito →
 * «enviado»; entregado → «entregado»; devuelto → «devuelto». Nunca toca
 * pedidos cancelados ni los hace retroceder.
 */
async function followOrder(tx: Tx, companyId: string, shipment: Shipment): Promise<void> {
  if (!shipment.orderId) return;
  const [order] = await tx.select().from(orders).where(and(eq(orders.id, shipment.orderId), eq(orders.companyId, companyId))).limit(1);
  if (!order || order.status === "cancelled") return;
  let target: OrderStatus | null = null;
  if (shipment.status === "label_created" || shipment.status === "in_transit" || shipment.status === "out_for_delivery") target = "shipped";
  else if (shipment.status === "delivered") target = "delivered";
  else if (shipment.status === "returned") target = "returned";
  if (!target || ORDER_RANK[target] <= ORDER_RANK[order.status]) return;
  if (order.status === "returned") return;
  await tx.update(orders).set({ status: target }).where(eq(orders.id, order.id));
  await syncOrderEffects(tx, companyId, order.id);
}

async function orderNumber(tx: Tx, companyId: string, orderId: string | null): Promise<string | null> {
  if (!orderId) return null;
  const [order] = await tx.select({ number: orders.number }).from(orders).where(and(eq(orders.id, orderId), eq(orders.companyId, companyId))).limit(1);
  if (!order) throw new ActionError("Revisa los campos marcados.", { orderId: "El pedido no existe" });
  return order.number;
}

export async function saveShipment(db: Db, companyId: string, input: ShipmentInput, today: string): Promise<Shipment> {
  return db.transaction(async (tx) => {
    const number = await orderNumber(tx, companyId, input.orderId);
    const sent = input.status !== "pending";
    const values = {
      orderId: input.orderId,
      carrier: input.carrier,
      service: input.service,
      trackingNumber: input.trackingNumber,
      trackingUrl: input.trackingUrl ?? trackingUrlFor(input.carrier, input.trackingNumber),
      status: input.status,
      costCents: input.cost ?? 0,
      weightG: input.weightG,
      recipientName: input.recipientName,
      destination: input.destination,
      shippedAt: input.shippedAt ?? (sent ? today : null),
      estimatedDelivery: input.estimatedDelivery,
      deliveredAt: input.status === "delivered" ? (input.deliveredAt ?? today) : input.deliveredAt,
      notes: input.notes,
    };
    const [row] = input.id
      ? await tx.update(shipments).set(values).where(and(eq(shipments.id, input.id), eq(shipments.companyId, companyId))).returning()
      : await tx.insert(shipments).values({ ...values, companyId }).returning();
    if (!row) throw new ActionError("El envío ya no existe.");
    await syncShipmentExpense(tx, row, { fallbackDate: today, orderNumber: number });
    await followOrder(tx, companyId, row);
    return row;
  });
}

export async function setShipmentStatus(db: Db, companyId: string, id: string, status: ShipmentStatus, today: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(shipments).where(and(eq(shipments.id, id), eq(shipments.companyId, companyId))).limit(1);
    if (!current) throw new ActionError("El envío ya no existe.");
    const patch: Partial<typeof shipments.$inferInsert> = { status };
    if (status !== "pending" && !current.shippedAt) patch.shippedAt = today;
    if (status === "delivered" && !current.deliveredAt) patch.deliveredAt = today;
    const [row] = await tx.update(shipments).set(patch).where(eq(shipments.id, current.id)).returning();
    await syncShipmentExpense(tx, row, { fallbackDate: today, orderNumber: await orderNumber(tx, companyId, row.orderId) });
    await followOrder(tx, companyId, row);
  });
}

export async function deleteShipment(db: Db, companyId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(shipments).where(and(eq(shipments.id, id), eq(shipments.companyId, companyId))).returning({ id: shipments.id, companyId: shipments.companyId });
    if (!row) throw new ActionError("El envío ya no existe.");
    await removeShipmentExpense(tx, row);
  });
}
