/** Lecturas del módulo de máquinas. Todas filtran por empresa. */
import "server-only";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { machineEvents, machines, maintenanceLogs, materials, printJobs, transactions, type Machine } from "@/server/db/schema";
import { count, countWhere, instant, sum, sumWhere } from "@/server/db/sql";

export interface MachineListItem extends Machine {
  loadedMaterialName: string | null;
}

export async function listMachines(db: DbOrTx, companyId: string): Promise<MachineListItem[]> {
  const rows = await db
    .select({ machine: machines, loadedMaterialName: materials.name })
    .from(machines)
    .leftJoin(materials, eq(materials.id, machines.loadedMaterialId))
    .where(eq(machines.companyId, companyId))
    .orderBy(asc(machines.sortOrder), asc(machines.createdAt));
  return rows.map((r) => ({ ...r.machine, loadedMaterialName: r.loadedMaterialName }));
}

export async function getMachine(db: DbOrTx, companyId: string, id: string): Promise<MachineListItem | null> {
  const rows = await db
    .select({ machine: machines, loadedMaterialName: materials.name })
    .from(machines)
    .leftJoin(materials, eq(materials.id, machines.loadedMaterialId))
    .where(and(eq(machines.id, id), eq(machines.companyId, companyId)))
    .limit(1);
  return rows[0] ? { ...rows[0].machine, loadedMaterialName: rows[0].loadedMaterialName } : null;
}

export interface MachineStats {
  completed: number;
  failed: number;
  /** Segundos de impresión en los últimos 30 días. */
  seconds30d: number;
  monthKwh: number;
  monthEnergyCents: number;
  maintenanceCents: number;
}

export async function getMachineStats(db: DbOrTx, companyId: string, machineId: string, monthStart: Date): Promise<MachineStats> {
  const since30d = new Date(Date.now() - 30 * 86_400_000);
  const scope = and(eq(printJobs.companyId, companyId), eq(printJobs.machineId, machineId));
  const [[jobs], [maintenance]] = await Promise.all([
    db
      .select({
        completed: countWhere(sql`${printJobs.status} = 'completed'`),
        failed: countWhere(sql`${printJobs.status} = 'failed'`),
        seconds30d: sumWhere(printJobs.durationSec, sql`${printJobs.startedAt} >= ${instant(since30d)}`),
        monthKwh: sumWhere(printJobs.energyKwh, sql`${printJobs.startedAt} >= ${instant(monthStart)}`),
        monthEnergyCents: sumWhere(printJobs.energyCostCents, sql`${printJobs.startedAt} >= ${instant(monthStart)}`),
      })
      .from(printJobs)
      .where(scope),
    db
      .select({ total: sum(maintenanceLogs.costCents) })
      .from(maintenanceLogs)
      .where(and(eq(maintenanceLogs.companyId, companyId), eq(maintenanceLogs.machineId, machineId))),
  ]);
  return { ...jobs, maintenanceCents: maintenance.total };
}

export async function listMachineEvents(db: DbOrTx, companyId: string, machineId: string, limit = 30) {
  return db
    .select({ id: machineEvents.id, type: machineEvents.type, message: machineEvents.message, createdAt: machineEvents.createdAt })
    .from(machineEvents)
    .where(and(eq(machineEvents.companyId, companyId), eq(machineEvents.machineId, machineId)))
    .orderBy(desc(machineEvents.createdAt))
    .limit(Math.min(limit, 200));
}

export async function listMaintenance(db: DbOrTx, companyId: string, machineId: string) {
  return db
    .select()
    .from(maintenanceLogs)
    .where(and(eq(maintenanceLogs.companyId, companyId), eq(maintenanceLogs.machineId, machineId)))
    .orderBy(desc(maintenanceLogs.date), desc(maintenanceLogs.createdAt));
}

export async function listMachineJobs(db: DbOrTx, companyId: string, machineId: string, limit = 10) {
  return db
    .select()
    .from(printJobs)
    .where(and(eq(printJobs.companyId, companyId), eq(printJobs.machineId, machineId)))
    .orderBy(desc(printJobs.startedAt))
    .limit(limit);
}

/** Materiales no archivados para desplegables. */
export async function listMaterialOptions(db: DbOrTx, companyId: string) {
  return db
    .select({
      id: materials.id,
      name: materials.name,
      unit: materials.unit,
      colorHex: materials.colorHex,
      stockQty: materials.stockQty,
      packSize: materials.packSize,
      packCostCents: materials.packCostCents,
      materialType: materials.materialType,
      kind: materials.kind,
    })
    .from(materials)
    .where(and(eq(materials.companyId, companyId), isNull(materials.archivedAt)))
    .orderBy(asc(materials.name));
}

/** Máquinas para desplegables. */
export async function listMachineOptions(db: DbOrTx, companyId: string) {
  return db
    .select({
      id: machines.id,
      name: machines.name,
      connectionType: machines.connectionType,
      status: machines.status,
      powerPrintW: machines.powerPrintW,
      purchasePriceCents: machines.purchasePriceCents,
      lifespanHours: machines.lifespanHours,
      loadedMaterialId: machines.loadedMaterialId,
    })
    .from(machines)
    .where(eq(machines.companyId, companyId))
    .orderBy(asc(machines.sortOrder), asc(machines.createdAt));
}

export async function countMachines(db: DbOrTx, companyId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(machines).where(eq(machines.companyId, companyId));
  return row.n;
}

export { gte };

/** ¿La compra de la máquina está apuntada como gasto en Finanzas? */
export async function hasMachinePurchaseExpense(db: DbOrTx, companyId: string, machineId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.companyId, companyId), eq(transactions.sourceType, "machine"), eq(transactions.sourceId, machineId)))
    .limit(1);
  return Boolean(row);
}
