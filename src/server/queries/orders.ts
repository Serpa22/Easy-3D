/** Lecturas de pedidos y clientes. Todas filtran por empresa. */
import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { customers, machines, materials, orderItems, orders, printJobs, products, shipments } from "@/server/db/schema";
import { count, countWhere, sum, sumWhere } from "@/server/db/sql";
import { OPEN_ORDER_STATUSES, SALES_CHANNELS, type OrderStatus, type SalesChannel } from "@/lib/domain";

export const ORDER_GROUPS = ["abiertos", "enviados", "entregados", "cancelados", "todos"] as const;
export type OrderGroup = (typeof ORDER_GROUPS)[number];

const GROUP_STATUSES: Record<Exclude<OrderGroup, "todos">, OrderStatus[]> = {
  abiertos: [...OPEN_ORDER_STATUSES],
  enviados: ["shipped"],
  entregados: ["delivered"],
  cancelados: ["cancelled", "returned"],
};

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export interface OrderFilters {
  group?: OrderGroup;
  q?: string;
  channel?: string;
  from?: string;
  to?: string;
  customerId?: string;
  page?: number;
  pageSize?: number;
}

export async function listOrders(db: DbOrTx, companyId: string, f: OrderFilters = {}) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 200);
  const base: SQL[] = [eq(orders.companyId, companyId)];
  const q = f.q?.trim();
  if (q) base.push(or(ilike(orders.number, like(q)), ilike(orders.customerName, like(q))) as SQL);
  if (f.channel && (SALES_CHANNELS as readonly string[]).includes(f.channel)) base.push(eq(orders.channel, f.channel as SalesChannel));
  if (f.from) base.push(gte(orders.orderDate, f.from));
  if (f.to) base.push(lte(orders.orderDate, f.to));
  if (f.customerId) base.push(eq(orders.customerId, f.customerId));

  const [groupCounts] = await db
    .select({
      abiertos: countWhere(sql`${orders.status} in ('pending','in_production','ready')`),
      enviados: countWhere(sql`${orders.status} = 'shipped'`),
      entregados: countWhere(sql`${orders.status} = 'delivered'`),
      cancelados: countWhere(sql`${orders.status} in ('cancelled','returned')`),
      todos: count(),
    })
    .from(orders)
    .where(and(...base));

  const group = f.group ?? "abiertos";
  const where = group === "todos" ? and(...base) : and(...base, inArray(orders.status, GROUP_STATUSES[group]));
  const total = groupCounts[group];
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(f.page ?? 1, 1), pageCount);
  const rows = await db
    .select()
    .from(orders)
    .where(where)
    .orderBy(desc(orders.orderDate), desc(orders.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total, page, pageCount, counts: groupCounts };
}

/** KPIs de pedidos: abiertos, pendiente de cobro y ventas cobradas del mes. */
export async function getOrderKpis(db: DbOrTx, companyId: string, range: { from: string; to: string }) {
  const [row] = await db
    .select({
      open: countWhere(sql`${orders.status} in ('pending','in_production','ready')`),
      unpaidCents: sumWhere(orders.totalCents, sql`${orders.paymentStatus} = 'unpaid' and ${orders.status} not in ('cancelled','returned')`),
      monthSalesCents: sumWhere(orders.totalCents, sql`${orders.paymentStatus} = 'paid' and ${orders.paidAt} >= ${range.from} and ${orders.paidAt} <= ${range.to}`),
      monthPaidOrders: countWhere(sql`${orders.paymentStatus} = 'paid' and ${orders.paidAt} >= ${range.from} and ${orders.paidAt} <= ${range.to}`),
    })
    .from(orders)
    .where(eq(orders.companyId, companyId));
  return row;
}

export async function getOrder(db: DbOrTx, companyId: string, id: string) {
  const [order] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.companyId, companyId))).limit(1);
  if (!order) return null;
  const [items, orderShipments, jobs, customer] = await Promise.all([
    db
      .select({ item: orderItems, product: products, material: materials, machine: machines })
      .from(orderItems)
      .leftJoin(products, and(eq(products.id, orderItems.productId), eq(products.companyId, companyId)))
      .leftJoin(materials, eq(materials.id, products.materialId))
      .leftJoin(machines, eq(machines.id, products.machineId))
      .where(eq(orderItems.orderId, order.id))
      .orderBy(asc(orderItems.sortOrder)),
    db.select().from(shipments).where(and(eq(shipments.orderId, order.id), eq(shipments.companyId, companyId))).orderBy(desc(shipments.createdAt)),
    db
      .select({ id: printJobs.id, name: printJobs.name, status: printJobs.status, startedAt: printJobs.startedAt })
      .from(printJobs)
      .where(and(eq(printJobs.orderId, order.id), eq(printJobs.companyId, companyId)))
      .orderBy(desc(printJobs.startedAt)),
    order.customerId ? db.select().from(customers).where(and(eq(customers.id, order.customerId), eq(customers.companyId, companyId))).limit(1) : Promise.resolve([]),
  ]);
  return { order, items, shipments: orderShipments, jobs, customer: customer[0] ?? null };
}

export async function listProductOptions(db: DbOrTx, companyId: string) {
  return db
    .select({ id: products.id, name: products.name, sku: products.sku, priceCents: products.priceCents, stockQty: products.stockQty })
    .from(products)
    .where(and(eq(products.companyId, companyId), eq(products.active, true)))
    .orderBy(asc(products.name));
}

export async function listCustomerOptions(db: DbOrTx, companyId: string) {
  return db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      addressLine: customers.addressLine,
      postalCode: customers.postalCode,
      city: customers.city,
      province: customers.province,
      country: customers.country,
    })
    .from(customers)
    .where(eq(customers.companyId, companyId))
    .orderBy(asc(customers.name));
}

/** Pedidos recientes no cancelados (para elegir en envíos e impresiones). */
export async function listOrderOptions(db: DbOrTx, companyId: string, limit = 80) {
  return db
    .select({
      id: orders.id,
      number: orders.number,
      customerName: orders.customerName,
      status: orders.status,
      shipName: orders.shipName,
      shipCity: orders.shipCity,
      shipCountry: orders.shipCountry,
    })
    .from(orders)
    .where(and(eq(orders.companyId, companyId), sql`${orders.status} not in ('cancelled','returned')`))
    .orderBy(desc(orders.orderDate), desc(orders.createdAt))
    .limit(limit);
}

/* ------------------------------- Clientes ------------------------------- */

export async function listCustomers(db: DbOrTx, companyId: string, f: { q?: string; sort?: "gasto" | "reciente" | "nombre"; page?: number } = {}) {
  const pageSize = 25;
  const conditions: SQL[] = [eq(customers.companyId, companyId)];
  const q = f.q?.trim();
  if (q) conditions.push(or(ilike(customers.name, like(q)), ilike(customers.email, like(q)), ilike(customers.city, like(q))) as SQL);
  const [{ total }] = await db.select({ total: count() }).from(customers).where(and(...conditions));
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(f.page ?? 1, 1), pageCount);
  const spent = sql<number>`coalesce(sum(${orders.totalCents}) filter (where ${orders.paymentStatus} = 'paid'), 0)::double precision`.mapWith(Number);
  const orderCount = sql<number>`count(${orders.id})::int`.mapWith(Number);
  const lastOrder = sql<string | null>`max(${orders.orderDate})`;
  const rows = await db
    .select({ customer: customers, orderCount, spentCents: spent, lastOrder })
    .from(customers)
    .leftJoin(orders, and(eq(orders.customerId, customers.id), eq(orders.companyId, companyId)))
    .where(and(...conditions))
    .groupBy(customers.id)
    .orderBy(f.sort === "nombre" ? asc(customers.name) : f.sort === "reciente" ? sql`max(${orders.orderDate}) desc nulls last` : desc(spent), asc(customers.name))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total, page, pageCount };
}

export async function getCustomer(db: DbOrTx, companyId: string, id: string) {
  const [customer] = await db.select().from(customers).where(and(eq(customers.id, id), eq(customers.companyId, companyId))).limit(1);
  if (!customer) return null;
  const [stats] = await db
    .select({
      orders: count(),
      spentCents: sumWhere(orders.totalCents, sql`${orders.paymentStatus} = 'paid'`),
      paidOrders: countWhere(sql`${orders.paymentStatus} = 'paid'`),
      first: sql<string | null>`min(${orders.orderDate})`,
      last: sql<string | null>`max(${orders.orderDate})`,
    })
    .from(orders)
    .where(and(eq(orders.companyId, companyId), eq(orders.customerId, id)));
  return { customer, stats };
}

export { sum };
