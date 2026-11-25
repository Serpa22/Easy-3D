/** Agregados para el resumen de una sub-empresa y la vista de grupo. */
import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, notExists, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { machines, maintenanceLogs, materials, orders, printJobs, products, shipments, transactions } from "@/server/db/schema";
import { count, monthKey, sum, sumWhere } from "@/server/db/sql";
import { addDays, monthRange } from "@/lib/dates";
import { ACTIVE_SHIPMENT_STATUSES, OPEN_ORDER_STATUSES } from "@/lib/domain";

export interface AttentionItem {
  key: string;
  tone: "danger" | "warn" | "neutral";
  text: string;
  href: string;
}

const OPEN = [...OPEN_ORDER_STATUSES];
const ACTIVE_SHIPMENTS = [...ACTIVE_SHIPMENT_STATUSES];

/** Contadores y listas para el resumen de una sub-empresa. */
export async function getCompanyOverview(db: DbOrTx, companyId: string, slug: string, today: string) {
  const base = `/e/${slug}`;
  const [
    [openOrders],
    [activeShipments],
    lowMaterials,
    overdueOrders,
    readyNoShipment,
    shipmentIssues,
    overdueMaintenance,
    deliveredUnpaid,
    recentOrders,
    recentJobs,
    machineRows,
    [counts],
  ] = await Promise.all([
    db
      .select({ n: count(), unpaidCents: sumWhere(orders.totalCents, sql`${orders.paymentStatus} = 'unpaid'`) })
      .from(orders)
      .where(and(eq(orders.companyId, companyId), inArray(orders.status, OPEN))),
    db.select({ n: count() }).from(shipments).where(and(eq(shipments.companyId, companyId), inArray(shipments.status, ACTIVE_SHIPMENTS))),
    db
      .select({ id: materials.id, name: materials.name, stockQty: materials.stockQty })
      .from(materials)
      .where(and(eq(materials.companyId, companyId), isNull(materials.archivedAt), sql`${materials.lowStockThreshold} > 0`, sql`${materials.stockQty} < ${materials.lowStockThreshold}`))
      .orderBy(asc(materials.stockQty))
      .limit(6),
    db
      .select({ id: orders.id, number: orders.number, dueDate: orders.dueDate })
      .from(orders)
      .where(and(eq(orders.companyId, companyId), inArray(orders.status, OPEN), isNotNull(orders.dueDate), lte(orders.dueDate, addDays(today, 3))))
      .orderBy(asc(orders.dueDate))
      .limit(6),
    db
      .select({ id: orders.id, number: orders.number })
      .from(orders)
      .where(
        and(
          eq(orders.companyId, companyId),
          eq(orders.status, "ready"),
          notExists(db.select({ x: sql`1` }).from(shipments).where(eq(shipments.orderId, orders.id))),
        ),
      )
      .limit(6),
    db
      .select({ id: shipments.id, status: shipments.status, recipientName: shipments.recipientName, estimatedDelivery: shipments.estimatedDelivery })
      .from(shipments)
      .where(
        and(
          eq(shipments.companyId, companyId),
          sql`(${shipments.status} = 'incident' or (${shipments.status} in ('in_transit','out_for_delivery') and ${shipments.estimatedDelivery} < ${today}))`,
        ),
      )
      .limit(6),
    db
      .select({ machineId: maintenanceLogs.machineId, name: machines.name, nextDueDate: sql<string>`min(${maintenanceLogs.nextDueDate})` })
      .from(maintenanceLogs)
      .innerJoin(machines, eq(machines.id, maintenanceLogs.machineId))
      .where(and(eq(maintenanceLogs.companyId, companyId), isNotNull(maintenanceLogs.nextDueDate), lt(maintenanceLogs.nextDueDate, today), sql`${machines.status} <> 'retired'`))
      .groupBy(maintenanceLogs.machineId, machines.name)
      .limit(6),
    db
      .select({ n: count(), cents: sum(orders.totalCents) })
      .from(orders)
      .where(and(eq(orders.companyId, companyId), eq(orders.status, "delivered"), eq(orders.paymentStatus, "unpaid"))),
    db
      .select({ id: orders.id, number: orders.number, customerName: orders.customerName, status: orders.status, totalCents: orders.totalCents, orderDate: orders.orderDate })
      .from(orders)
      .where(eq(orders.companyId, companyId))
      .orderBy(desc(orders.orderDate), desc(orders.createdAt))
      .limit(5),
    db
      .select({ id: printJobs.id, name: printJobs.name, status: printJobs.status, startedAt: printJobs.startedAt, durationSec: printJobs.durationSec, machineName: machines.name })
      .from(printJobs)
      .leftJoin(machines, eq(machines.id, printJobs.machineId))
      .where(eq(printJobs.companyId, companyId))
      .orderBy(desc(printJobs.startedAt))
      .limit(5),
    db
      .select({ id: machines.id, name: machines.name })
      .from(machines)
      .where(and(eq(machines.companyId, companyId), sql`${machines.status} <> 'retired'`))
      .orderBy(asc(machines.sortOrder), asc(machines.createdAt)),
    db
      .select({
        materials: sql<number>`(select count(*)::int from ${materials} where ${materials.companyId} = ${companyId})`.mapWith(Number),
        products: sql<number>`(select count(*)::int from ${products} where ${products.companyId} = ${companyId})`.mapWith(Number),
        orders: sql<number>`(select count(*)::int from ${orders} where ${orders.companyId} = ${companyId})`.mapWith(Number),
        transactions: sql<number>`(select count(*)::int from ${transactions} where ${transactions.companyId} = ${companyId})`.mapWith(Number),
      })
      .from(sql`(select 1) as one`),
  ]);

  const attention: AttentionItem[] = [];
  for (const o of overdueOrders) {
    const late = o.dueDate! < today;
    attention.push({ key: `o-${o.id}`, tone: late ? "danger" : "warn", text: `Pedido ${o.number}: ${late ? "fecha límite vencida" : o.dueDate === today ? "vence hoy" : "vence en los próximos días"}`, href: `${base}/pedidos/${o.id}` });
  }
  for (const s of shipmentIssues) {
    attention.push({ key: `s-${s.id}`, tone: s.status === "incident" ? "danger" : "warn", text: `Envío a ${s.recipientName ?? "cliente"}: ${s.status === "incident" ? "incidencia" : "entrega prevista superada"}`, href: `${base}/envios?estado=curso` });
  }
  for (const o of readyNoShipment) attention.push({ key: `r-${o.id}`, tone: "warn", text: `Pedido ${o.number} listo y sin envío creado`, href: `${base}/pedidos/${o.id}` });
  for (const m of lowMaterials) attention.push({ key: `m-${m.id}`, tone: m.stockQty <= 0 ? "danger" : "warn", text: `${m.name}: ${m.stockQty <= 0 ? "agotado" : "stock bajo"}`, href: `${base}/materiales/${m.id}` });
  for (const m of overdueMaintenance) attention.push({ key: `mt-${m.machineId}`, tone: "warn", text: `${m.name}: revisión de mantenimiento vencida`, href: `${base}/maquinas/${m.machineId}?tab=mantenimiento` });
  if (deliveredUnpaid[0].n > 0) attention.push({ key: "unpaid", tone: "warn", text: `${deliveredUnpaid[0].n} ${deliveredUnpaid[0].n === 1 ? "pedido entregado sin cobrar" : "pedidos entregados sin cobrar"}`, href: `${base}/pedidos?estado=entregados` });

  return {
    openOrders: openOrders.n,
    unpaidOpenCents: openOrders.unpaidCents,
    activeShipments: activeShipments.n,
    attention,
    recentOrders,
    recentJobs,
    machines: machineRows,
    counts: { ...counts, machines: machineRows.length },
  };
}

export interface GroupCompanyStats {
  incomeCents: number;
  expenseCents: number;
  openOrders: number;
  /** Ingresos de los últimos meses (ascendente), alineados con `months`. */
  incomeSeries: number[];
  machines: Array<{ id: string; name: string }>;
  lowStock: number;
}

/** Cifras por sub-empresa para la vista de grupo (consultas agrupadas, sin N+1). */
export async function getGroupOverview(db: DbOrTx, companyIds: string[], month: string, months: string[]): Promise<Map<string, GroupCompanyStats>> {
  const out = new Map<string, GroupCompanyStats>(
    companyIds.map((id) => [id, { incomeCents: 0, expenseCents: 0, openOrders: 0, incomeSeries: months.map(() => 0), machines: [], lowStock: 0 }]),
  );
  if (companyIds.length === 0) return out;
  const from = monthRange(months[0]).from;
  const to = monthRange(months[months.length - 1]).to;
  const key = monthKey(transactions.date);
  const [tx, open, machineRows, low] = await Promise.all([
    db
      .select({
        companyId: transactions.companyId,
        month: key,
        incomeCents: sumWhere(transactions.amountCents, sql`${transactions.type} = 'income'`),
        expenseCents: sumWhere(transactions.amountCents, sql`${transactions.type} = 'expense'`),
      })
      .from(transactions)
      .where(and(inArray(transactions.companyId, companyIds), gte(transactions.date, from), lte(transactions.date, to)))
      .groupBy(transactions.companyId, key),
    db.select({ companyId: orders.companyId, n: count() }).from(orders).where(and(inArray(orders.companyId, companyIds), inArray(orders.status, OPEN))).groupBy(orders.companyId),
    db
      .select({ id: machines.id, name: machines.name, companyId: machines.companyId })
      .from(machines)
      .where(and(inArray(machines.companyId, companyIds), sql`${machines.status} <> 'retired'`))
      .orderBy(asc(machines.sortOrder), asc(machines.createdAt)),
    db
      .select({ companyId: materials.companyId, n: count() })
      .from(materials)
      .where(and(inArray(materials.companyId, companyIds), isNull(materials.archivedAt), sql`${materials.lowStockThreshold} > 0`, sql`${materials.stockQty} < ${materials.lowStockThreshold}`))
      .groupBy(materials.companyId),
  ]);
  for (const row of tx) {
    const stats = out.get(row.companyId);
    if (!stats) continue;
    const index = months.indexOf(row.month);
    if (index >= 0) stats.incomeSeries[index] = row.incomeCents;
    if (row.month === month) {
      stats.incomeCents = row.incomeCents;
      stats.expenseCents = row.expenseCents;
    }
  }
  for (const row of open) out.get(row.companyId)!.openOrders = row.n;
  for (const row of machineRows) out.get(row.companyId)!.machines.push({ id: row.id, name: row.name });
  for (const row of low) out.get(row.companyId)!.lowStock = row.n;
  return out;
}
