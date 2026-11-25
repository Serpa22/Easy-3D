/** Lecturas de impresiones. Todas filtran por empresa. */
import "server-only";
import { and, desc, eq, gte, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { machines, materials, orders, printJobs, products } from "@/server/db/schema";
import { count, countWhere, instant, sum, sumWhere } from "@/server/db/sql";

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export interface PrintFilters {
  from: Date;
  to: Date;
  status?: "en-curso" | "completada" | "fallida" | "cancelada";
  machineId?: string;
  source?: "live" | "manual";
  q?: string;
  page?: number;
}

export async function listPrintJobs(db: DbOrTx, companyId: string, f: PrintFilters) {
  const pageSize = 25;
  const conditions: SQL[] = [eq(printJobs.companyId, companyId)];
  // Las impresiones en curso se muestran siempre, sea cual sea el mes.
  if (f.status === "en-curso") conditions.push(isNull(printJobs.endedAt));
  else conditions.push(or(and(gte(printJobs.startedAt, f.from), lt(printJobs.startedAt, f.to)), isNull(printJobs.endedAt)) as SQL);
  if (f.status === "completada") conditions.push(eq(printJobs.status, "completed"));
  if (f.status === "fallida") conditions.push(eq(printJobs.status, "failed"));
  if (f.status === "cancelada") conditions.push(eq(printJobs.status, "cancelled"));
  if (f.machineId) conditions.push(eq(printJobs.machineId, f.machineId));
  if (f.source) conditions.push(eq(printJobs.source, f.source));
  const q = f.q?.trim();
  if (q) conditions.push(or(ilike(printJobs.name, like(q)), ilike(printJobs.fileName, like(q))) as SQL);
  const [{ total }] = await db.select({ total: count() }).from(printJobs).where(and(...conditions));
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(f.page ?? 1, 1), pageCount);
  const rows = await db
    .select({
      job: printJobs,
      machineName: machines.name,
      machinePriceCents: machines.purchasePriceCents,
      machineLifespan: machines.lifespanHours,
      materialName: materials.name,
      materialUnit: materials.unit,
      productName: products.name,
      orderNumber: orders.number,
    })
    .from(printJobs)
    .leftJoin(machines, eq(machines.id, printJobs.machineId))
    .leftJoin(materials, eq(materials.id, printJobs.materialId))
    .leftJoin(products, eq(products.id, printJobs.productId))
    .leftJoin(orders, eq(orders.id, printJobs.orderId))
    .where(and(...conditions))
    .orderBy(sql`${printJobs.endedAt} is null desc`, desc(printJobs.startedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total, page, pageCount };
}

export async function getPrintKpis(db: DbOrTx, companyId: string, from: Date, to: Date) {
  const inMonth = sql`${printJobs.startedAt} >= ${instant(from)} and ${printJobs.startedAt} < ${instant(to)}`;
  const [[row], material] = await Promise.all([
    db
      .select({
        open: countWhere(sql`${printJobs.endedAt} is null`),
        completed: countWhere(sql`${printJobs.status} = 'completed' and ${inMonth}`),
        failed: countWhere(sql`${printJobs.status} = 'failed' and ${inMonth}`),
        seconds: sumWhere(printJobs.durationSec, inMonth),
        energyCents: sumWhere(printJobs.energyCostCents, inMonth),
        energyKwh: sumWhere(printJobs.energyKwh, inMonth),
      })
      .from(printJobs)
      .where(eq(printJobs.companyId, companyId)),
    db
      .select({ unit: materials.unit, qty: sum(printJobs.materialUsed) })
      .from(printJobs)
      .innerJoin(materials, eq(materials.id, printJobs.materialId))
      .where(and(eq(printJobs.companyId, companyId), gte(printJobs.startedAt, from), lt(printJobs.startedAt, to)))
      .groupBy(materials.unit),
  ]);
  return { ...row, material };
}

/** Impresiones por día local del mes (completadas / fallidas). */
export async function getDailyPrints(db: DbOrTx, companyId: string, from: Date, to: Date, timeZone: string) {
  const day = sql<string>`to_char(${printJobs.startedAt} at time zone ${timeZone}, 'YYYY-MM-DD')`;
  return db
    .select({ day, completed: countWhere(sql`${printJobs.status} = 'completed'`), failed: countWhere(sql`${printJobs.status} in ('failed','cancelled')`) })
    .from(printJobs)
    .where(and(eq(printJobs.companyId, companyId), gte(printJobs.startedAt, from), lt(printJobs.startedAt, to), inArray(printJobs.status, ["completed", "failed", "cancelled"])))
    // Por posición: la zona horaria va como parámetro y Postgres no sabría que es la misma expresión.
    .groupBy(sql`1`);
}
