/** Lecturas de materiales. Todas filtran por empresa. */
import "server-only";
import { and, asc, desc, eq, gte, ilike, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { machines, materialMovements, materials, printJobs, products } from "@/server/db/schema";
import { count, countWhere, monthKey, sum, sumWhere } from "@/server/db/sql";
import { MATERIAL_KINDS, type MaterialKind } from "@/lib/domain";

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Valor en stock de un material: envases equivalentes × precio del envase. */
export const stockValueSql = sql<number>`case when ${materials.packSize} > 0 then greatest(${materials.stockQty}, 0) / ${materials.packSize} * ${materials.packCostCents} else 0 end`;

/** Bajo el mínimo configurado, o en negativo (más consumo que compras registradas). */
const needsAttention = sql`((${materials.lowStockThreshold} > 0 and ${materials.stockQty} < ${materials.lowStockThreshold}) or ${materials.stockQty} < 0)`;

export async function listMaterials(db: DbOrTx, companyId: string, f: { kind?: string; q?: string; lowOnly?: boolean; archived?: boolean } = {}) {
  const base: SQL[] = [eq(materials.companyId, companyId), f.archived ? isNotNull(materials.archivedAt) : isNull(materials.archivedAt)];
  const q = f.q?.trim();
  if (q) base.push(or(ilike(materials.name, like(q)), ilike(materials.brand, like(q)), ilike(materials.materialType, like(q)), ilike(materials.colorName, like(q))) as SQL);
  if (f.lowOnly) base.push(needsAttention);
  const [counts] = await db
    .select({
      todos: count(),
      filament: countWhere(sql`${materials.kind} = 'filament'`),
      resin: countWhere(sql`${materials.kind} = 'resin'`),
      consumable: countWhere(sql`${materials.kind} = 'consumable'`),
      packaging: countWhere(sql`${materials.kind} = 'packaging'`),
      other: countWhere(sql`${materials.kind} = 'other'`),
    })
    .from(materials)
    .where(and(...base));
  const kind = (MATERIAL_KINDS as readonly string[]).includes(f.kind ?? "") ? (f.kind as MaterialKind) : undefined;
  const rows = await db
    .select()
    .from(materials)
    .where(kind ? and(...base, eq(materials.kind, kind)) : and(...base))
    .orderBy(asc(materials.kind), asc(materials.name));
  return { rows, counts, kind };
}

export async function getMaterialKpis(db: DbOrTx, companyId: string, monthFrom: string, monthTo: string) {
  const [[stock], consumption, [purchases]] = await Promise.all([
    db
      .select({
        valueCents: sql<number>`coalesce(sum(${stockValueSql}), 0)::double precision`.mapWith(Number),
        low: countWhere(needsAttention),
      })
      .from(materials)
      .where(and(eq(materials.companyId, companyId), isNull(materials.archivedAt))),
    db
      .select({ unit: materials.unit, qty: sql<number>`coalesce(sum(-${materialMovements.qty}), 0)::double precision`.mapWith(Number) })
      .from(materialMovements)
      .innerJoin(materials, eq(materials.id, materialMovements.materialId))
      .where(and(eq(materialMovements.companyId, companyId), sql`${materialMovements.type} in ('consumption','waste')`, gte(materialMovements.date, monthFrom), lte(materialMovements.date, monthTo)))
      .groupBy(materials.unit),
    db
      .select({ cents: sum(materialMovements.totalCostCents) })
      .from(materialMovements)
      .where(and(eq(materialMovements.companyId, companyId), eq(materialMovements.type, "purchase"), gte(materialMovements.date, monthFrom), lte(materialMovements.date, monthTo))),
  ]);
  return { valueCents: stock.valueCents, low: stock.low, consumption, purchaseCents: purchases.cents };
}

export async function getMaterial(db: DbOrTx, companyId: string, id: string, since30: string, months: string[]) {
  const [material] = await db.select().from(materials).where(and(eq(materials.id, id), eq(materials.companyId, companyId))).limit(1);
  if (!material) return null;
  const month = monthKey(materialMovements.date);
  const [movements, [recent], monthly, loadedIn, usedIn, [movementCount]] = await Promise.all([
    db
      .select({ movement: materialMovements, jobName: printJobs.name })
      .from(materialMovements)
      .leftJoin(printJobs, eq(printJobs.id, materialMovements.printJobId))
      .where(and(eq(materialMovements.materialId, id), eq(materialMovements.companyId, companyId)))
      .orderBy(desc(materialMovements.date), desc(materialMovements.createdAt))
      .limit(60),
    db
      .select({ used: sumWhere(sql`-${materialMovements.qty}`, sql`${materialMovements.type} in ('consumption','waste') and ${materialMovements.date} >= ${since30}`) })
      .from(materialMovements)
      .where(and(eq(materialMovements.materialId, id), eq(materialMovements.companyId, companyId))),
    db
      .select({ month, used: sql<number>`coalesce(sum(-${materialMovements.qty}), 0)::double precision`.mapWith(Number) })
      .from(materialMovements)
      .where(and(eq(materialMovements.materialId, id), eq(materialMovements.companyId, companyId), sql`${materialMovements.type} in ('consumption','waste')`, gte(materialMovements.date, `${months[0]}-01`)))
      .groupBy(month),
    db.select({ id: machines.id, name: machines.name }).from(machines).where(and(eq(machines.companyId, companyId), eq(machines.loadedMaterialId, id))),
    db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.companyId, companyId), eq(products.materialId, id))).orderBy(asc(products.name)),
    db.select({ n: count() }).from(materialMovements).where(and(eq(materialMovements.materialId, id), eq(materialMovements.companyId, companyId))),
  ]);
  const byMonth = new Map(monthly.map((m) => [m.month, m.used]));
  return { material, movements, used30: recent.used, monthly: months.map((m) => ({ month: m, used: byMonth.get(m) ?? 0 })), loadedIn, usedIn, movementCount: movementCount.n };
}
