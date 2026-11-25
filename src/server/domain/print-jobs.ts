/**
 * Ciclo de vida de una impresión (trabajo de impresión).
 *
 * Tanto la conexión en directo con las máquinas como el alta manual pasan por
 * aquí, de modo que al terminar una impresión siempre ocurre lo mismo:
 *   - se calcula la energía consumida y su coste con la tarifa de la empresa,
 *   - se descuenta el material usado del stock (movimiento de consumo),
 *   - se suman las horas a la máquina,
 *   - se suman las piezas producidas al stock del producto.
 * `finishPrintJob` es idempotente: llamarla otra vez (p. ej. al corregir los
 * gramos usados) deshace el efecto anterior y aplica el nuevo.
 */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { companies, machines, materialMovements, materials, printJobs, products, type PrintJob } from "@/server/db/schema";
import { energyCost } from "@/lib/energy";
import { dateToISO } from "@/lib/dates";
import { DEFAULT_TIME_ZONE } from "@/lib/format";
import { ActionError } from "@/server/action";
import { applyMaterialMovement, materialCostCents, revertMaterialMovement } from "./stock";

export interface StartPrintJobInput {
  companyId: string;
  machineId: string | null;
  name: string;
  fileName?: string | null;
  source: "live" | "manual";
  startedAt: Date;
  /** Si no se indica se usa el material cargado en la máquina. */
  materialId?: string | null;
  productId?: string | null;
  orderId?: string | null;
  estimatedSec?: number | null;
  thumbnailUrl?: string | null;
  notes?: string | null;
}

/** Abre una impresión en curso. */
export async function startPrintJob(tx: DbOrTx, input: StartPrintJobInput): Promise<PrintJob> {
  let materialId = input.materialId ?? null;
  if (input.machineId) {
    const [machine] = await tx
      .select({ id: machines.id, loadedMaterialId: machines.loadedMaterialId })
      .from(machines)
      .where(and(eq(machines.id, input.machineId), eq(machines.companyId, input.companyId)))
      .limit(1);
    if (!machine) throw new ActionError("La máquina no existe.");
    if (materialId === null) materialId = machine.loadedMaterialId ?? null;
  }
  const [job] = await tx
    .insert(printJobs)
    .values({
      companyId: input.companyId,
      machineId: input.machineId,
      name: input.name.trim().slice(0, 200) || "Impresión",
      fileName: input.fileName ?? null,
      source: input.source,
      status: "printing",
      startedAt: input.startedAt,
      materialId,
      productId: input.productId ?? null,
      orderId: input.orderId ?? null,
      estimatedSec: input.estimatedSec && input.estimatedSec > 0 ? Math.round(input.estimatedSec) : null,
      thumbnailUrl: input.thumbnailUrl ?? null,
      notes: input.notes ?? null,
    })
    .returning();
  return job;
}

export interface FinishPrintJobInput {
  companyId: string;
  jobId: string;
  status: "completed" | "failed" | "cancelled";
  endedAt: Date;
  /** Tiempo real de impresión; por defecto, fin − inicio. */
  durationSec?: number;
  /** Material consumido, en la unidad del material (g / ml). */
  materialUsed?: number;
  piecesProduced?: number;
  piecesFailed?: number;
  errorMessage?: string | null;
  /** Zona horaria para el coste por periodos y la fecha del movimiento de material. */
  timeZone?: string;
}

/** Deshace los efectos de stock/horas de un trabajo ya cerrado (para recalcular o borrar). */
async function revertJobEffects(tx: DbOrTx, job: PrintJob): Promise<void> {
  const movements = await tx
    .select({ id: materialMovements.id })
    .from(materialMovements)
    .where(and(eq(materialMovements.printJobId, job.id), eq(materialMovements.companyId, job.companyId)));
  for (const m of movements) await revertMaterialMovement(tx, job.companyId, m.id);

  if (job.endedAt && job.machineId && job.durationSec > 0) {
    await tx
      .update(machines)
      .set({ totalPrintSeconds: sql`greatest(${machines.totalPrintSeconds} - ${job.durationSec}, 0)` })
      .where(and(eq(machines.id, job.machineId), eq(machines.companyId, job.companyId)));
  }
  if (job.endedAt && job.productId && job.piecesProduced > 0) {
    await tx
      .update(products)
      .set({ stockQty: sql`greatest(${products.stockQty} - ${job.piecesProduced}, 0)` })
      .where(and(eq(products.id, job.productId), eq(products.companyId, job.companyId)));
  }
}

/** Cierra una impresión (o recalcula una ya cerrada) aplicando energía, material, horas y piezas. */
export async function finishPrintJob(tx: DbOrTx, input: FinishPrintJobInput): Promise<PrintJob> {
  const [job] = await tx
    .select()
    .from(printJobs)
    .where(and(eq(printJobs.id, input.jobId), eq(printJobs.companyId, input.companyId)))
    .limit(1);
  if (!job) throw new ActionError("La impresión no existe.");

  await revertJobEffects(tx, job);

  const [company] = await tx.select().from(companies).where(eq(companies.id, input.companyId)).limit(1);
  const machine = job.machineId
    ? (await tx.select().from(machines).where(and(eq(machines.id, job.machineId), eq(machines.companyId, input.companyId))).limit(1))[0]
    : undefined;
  const material = job.materialId
    ? (await tx.select().from(materials).where(and(eq(materials.id, job.materialId), eq(materials.companyId, input.companyId))).limit(1))[0]
    : undefined;

  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const endedAt = input.endedAt.getTime() < job.startedAt.getTime() ? job.startedAt : input.endedAt;
  const wallSec = Math.max(0, Math.round((endedAt.getTime() - job.startedAt.getTime()) / 1000));
  const durationSec = Math.max(0, Math.round(input.durationSec ?? wallSec));

  const energy = machine
    ? energyCost(company, { start: job.startedAt, durationSec, watts: machine.powerPrintW, timeZone })
    : { kwh: 0, costCents: 0 };

  const materialUsed = Math.max(0, input.materialUsed ?? job.materialUsed ?? 0);
  const piecesProduced = Math.max(0, Math.round(input.piecesProduced ?? job.piecesProduced ?? 0));
  const piecesFailed = Math.max(0, Math.round(input.piecesFailed ?? job.piecesFailed ?? 0));

  if (material && materialUsed > 0) {
    await applyMaterialMovement(tx, {
      companyId: input.companyId,
      materialId: material.id,
      type: "consumption",
      qty: materialUsed,
      date: dateToISO(endedAt, timeZone),
      printJobId: job.id,
      note: `Impresión: ${job.name}`,
    });
  }
  if (machine && durationSec > 0) {
    await tx
      .update(machines)
      .set({ totalPrintSeconds: sql`${machines.totalPrintSeconds} + ${durationSec}` })
      .where(eq(machines.id, machine.id));
  }
  if (job.productId && piecesProduced > 0) {
    await tx
      .update(products)
      .set({ stockQty: sql`${products.stockQty} + ${piecesProduced}` })
      .where(and(eq(products.id, job.productId), eq(products.companyId, input.companyId)));
  }

  const [updated] = await tx
    .update(printJobs)
    .set({
      status: input.status,
      endedAt,
      durationSec,
      progress: input.status === "completed" ? 100 : job.progress,
      materialUsed,
      materialCostCents: material ? materialCostCents(material, materialUsed) : 0,
      piecesProduced,
      piecesFailed,
      energyKwh: energy.kwh,
      energyCostCents: energy.costCents,
      errorMessage: input.errorMessage === undefined ? job.errorMessage : input.errorMessage,
    })
    .where(eq(printJobs.id, job.id))
    .returning();
  return updated;
}

/** Borra una impresión deshaciendo antes su efecto en stock, horas y piezas. */
export async function deletePrintJob(tx: DbOrTx, companyId: string, jobId: string): Promise<void> {
  const [job] = await tx
    .select()
    .from(printJobs)
    .where(and(eq(printJobs.id, jobId), eq(printJobs.companyId, companyId)))
    .limit(1);
  if (!job) throw new ActionError("La impresión no existe.");
  await revertJobEffects(tx, job);
  await tx.delete(printJobs).where(eq(printJobs.id, job.id));
}
