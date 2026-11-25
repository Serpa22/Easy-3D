/** Lecturas de productos. Todas filtran por empresa. */
import "server-only";
import { and, asc, desc, eq, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { machines, materials, orderItems, orders, printJobs, products } from "@/server/db/schema";

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Unidades vendidas (pedidos no cancelados ni devueltos) desde una fecha: subconsulta por producto. */
const soldSince = (since: string) =>
  sql<number>`coalesce((select sum(${orderItems.quantity}) from ${orderItems} inner join ${orders} on ${orders.id} = ${orderItems.orderId} where ${orderItems.productId} = ${products.id} and ${orders.status} not in ('cancelled','returned') and ${orders.orderDate} >= ${since}), 0)::int`.mapWith(Number);

export async function listProducts(db: DbOrTx, companyId: string, f: { q?: string; category?: string; since30: string }) {
  const conditions: SQL[] = [eq(products.companyId, companyId)];
  const q = f.q?.trim();
  if (q) conditions.push(or(ilike(products.name, like(q)), ilike(products.sku, like(q))) as SQL);
  if (f.category) conditions.push(eq(products.category, f.category));
  const [rows, categories] = await Promise.all([
    db
      .select({ product: products, material: materials, machine: machines, sold30: soldSince(f.since30) })
      .from(products)
      .leftJoin(materials, eq(materials.id, products.materialId))
      .leftJoin(machines, eq(machines.id, products.machineId))
      .where(and(...conditions))
      .orderBy(desc(products.active), asc(products.category), asc(products.name)),
    db.selectDistinct({ category: products.category }).from(products).where(and(eq(products.companyId, companyId), sql`${products.category} is not null`)).orderBy(asc(products.category)),
  ]);
  return { rows, categories: categories.map((c) => c.category!).filter(Boolean) };
}

export async function getProduct(db: DbOrTx, companyId: string, id: string, since: { d30: string; d90: string; d365: string }, months: string[]) {
  const [row] = await db
    .select({ product: products, material: materials, machine: machines })
    .from(products)
    .leftJoin(materials, eq(materials.id, products.materialId))
    .leftJoin(machines, eq(machines.id, products.machineId))
    .where(and(eq(products.id, id), eq(products.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  const valid = sql`${orders.status} not in ('cancelled','returned')`;
  const month = sql<string>`to_char(${orders.orderDate}, 'YYYY-MM')`;
  const [[sales], monthly, jobs] = await Promise.all([
    db
      .select({
        u30: sql<number>`coalesce(sum(${orderItems.quantity}) filter (where ${orders.orderDate} >= ${since.d30}), 0)::int`.mapWith(Number),
        u90: sql<number>`coalesce(sum(${orderItems.quantity}) filter (where ${orders.orderDate} >= ${since.d90}), 0)::int`.mapWith(Number),
        u365: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`.mapWith(Number),
        r365: sql<number>`coalesce(sum(${orderItems.totalCents}), 0)::double precision`.mapWith(Number),
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orderItems.productId, id), eq(orders.companyId, companyId), valid, gte(orders.orderDate, since.d365))),
    db
      .select({ month, units: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`.mapWith(Number) })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orderItems.productId, id), eq(orders.companyId, companyId), valid, gte(orders.orderDate, `${months[0]}-01`)))
      .groupBy(month),
    db
      .select({ id: printJobs.id, name: printJobs.name, status: printJobs.status, startedAt: printJobs.startedAt, piecesProduced: printJobs.piecesProduced, piecesFailed: printJobs.piecesFailed, machineName: machines.name })
      .from(printJobs)
      .leftJoin(machines, eq(machines.id, printJobs.machineId))
      .where(and(eq(printJobs.productId, id), eq(printJobs.companyId, companyId)))
      .orderBy(desc(printJobs.startedAt))
      .limit(6),
  ]);
  const byMonth = new Map(monthly.map((m) => [m.month, m.units]));
  return { ...row, sales, monthly: months.map((m) => ({ month: m, units: byMonth.get(m) ?? 0 })), jobs };
}
