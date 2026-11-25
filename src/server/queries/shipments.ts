/** Lecturas de envíos. Todas filtran por empresa. */
import "server-only";
import { and, desc, eq, ilike, inArray, notExists, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { orders, shipments } from "@/server/db/schema";
import { count, countWhere, sumWhere } from "@/server/db/sql";
import { ACTIVE_SHIPMENT_STATUSES, type ShipmentStatus } from "@/lib/domain";

export const SHIPMENT_GROUPS = ["curso", "entregados", "devueltos", "todos"] as const;
export type ShipmentGroup = (typeof SHIPMENT_GROUPS)[number];
const GROUPS: Record<Exclude<ShipmentGroup, "todos">, ShipmentStatus[]> = {
  curso: [...ACTIVE_SHIPMENT_STATUSES],
  entregados: ["delivered"],
  devueltos: ["returned"],
};
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function listShipments(db: DbOrTx, companyId: string, f: { group?: ShipmentGroup; q?: string; carrier?: string; page?: number } = {}) {
  const pageSize = 25;
  const base: SQL[] = [eq(shipments.companyId, companyId)];
  const q = f.q?.trim();
  if (q) base.push(or(ilike(shipments.trackingNumber, like(q)), ilike(shipments.recipientName, like(q)), ilike(orders.number, like(q))) as SQL);
  if (f.carrier) base.push(eq(shipments.carrier, f.carrier));
  const from = () => db.select({ shipment: shipments, orderNumber: orders.number }).from(shipments).leftJoin(orders, eq(orders.id, shipments.orderId));
  const [counts] = await db
    .select({
      curso: countWhere(sql`${shipments.status} in ('pending','label_created','in_transit','out_for_delivery','incident')`),
      entregados: countWhere(sql`${shipments.status} = 'delivered'`),
      devueltos: countWhere(sql`${shipments.status} = 'returned'`),
      todos: count(),
    })
    .from(shipments)
    .leftJoin(orders, eq(orders.id, shipments.orderId))
    .where(and(...base));
  const group = f.group ?? "curso";
  const where = group === "todos" ? and(...base) : and(...base, inArray(shipments.status, GROUPS[group]));
  const total = counts[group];
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(f.page ?? 1, 1), pageCount);
  const rows = await from()
    .where(where)
    .orderBy(sql`${shipments.shippedAt} desc nulls first`, desc(shipments.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total, page, pageCount, counts };
}

export async function getShipmentKpis(db: DbOrTx, companyId: string, monthFrom: string, monthTo: string, since90: string) {
  const [row] = await db
    .select({
      pending: countWhere(sql`${shipments.status} in ('pending','label_created')`),
      moving: countWhere(sql`${shipments.status} in ('in_transit','out_for_delivery')`),
      incidents: countWhere(sql`${shipments.status} = 'incident'`),
      monthCostCents: sumWhere(shipments.costCents, sql`${shipments.shippedAt} >= ${monthFrom} and ${shipments.shippedAt} <= ${monthTo}`),
      deliveredCount: countWhere(sql`${shipments.status} = 'delivered' and ${shipments.deliveredAt} >= ${since90} and ${shipments.shippedAt} is not null`),
      deliveredDays: sql<number>`coalesce(sum(${shipments.deliveredAt} - ${shipments.shippedAt}) filter (where ${shipments.status} = 'delivered' and ${shipments.deliveredAt} >= ${since90} and ${shipments.shippedAt} is not null), 0)::double precision`.mapWith(Number),
    })
    .from(shipments)
    .where(eq(shipments.companyId, companyId));
  return row;
}

/** Pedidos listos para enviar que todavía no tienen envío. */
export async function listReadyWithoutShipment(db: DbOrTx, companyId: string) {
  return db
    .select({ id: orders.id, number: orders.number, customerName: orders.customerName, shipCity: orders.shipCity })
    .from(orders)
    .where(and(eq(orders.companyId, companyId), eq(orders.status, "ready"), notExists(db.select({ x: sql`1` }).from(shipments).where(eq(shipments.orderId, orders.id)))))
    .orderBy(orders.orderDate)
    .limit(12);
}
