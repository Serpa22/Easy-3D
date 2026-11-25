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
 * gramos usados) aplica solo la DIFERENCIA respecto a lo que ya estaba contado.
 * Corregir una nota no mueve ni el stock ni los costes ya calculados.
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
  if (materialId) {
    // Un material borrado no debe impedir que la impresión quede registrada.
    const [material] = await tx
      .select({ id: materials.id })
      .from(materials)
      .where(and(eq(materials.id, materialId), eq(materials.companyId, input.companyId)))
      .limit(1);
    if (!material) materialId = null;
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
  /**
   * Al corregir una impresión: nuevos vínculos y textos. Una clave ausente
   * (`undefined`) deja el valor como está; `null` lo quita.
   */
  changes?: {
    name?: string;
    notes?: string | null;
    productId?: string | null;
    orderId?: string | null;
    materialId?: string | null;
  };
}

/** Suma (o resta) unidades al stock de un producto. Restando, nunca baja de 0. */
async function addProductStock(tx: DbOrTx, companyId: string, productId: string, delta: number): Promise<void> {
  if (delta === 0) return;
  await tx
    .update(products)
    .set({ stockQty: delta > 0 ? sql`${products.stockQty} + ${delta}` : sql`greatest(${products.stockQty} + ${delta}, 0)` })
    .where(and(eq(products.id, productId), eq(products.companyId, companyId)));
}

/** Suma (o resta) segundos al contador de la máquina. */
async function addMachineSeconds(tx: DbOrTx, companyId: string, machineId: string, delta: number): Promise<void> {
  if (delta === 0) return;
  await tx
    .update(machines)
    .set({ totalPrintSeconds: delta > 0 ? sql`${machines.totalPrintSeconds} + ${delta}` : sql`greatest(${machines.totalPrintSeconds} + ${delta}, 0)` })
    .where(and(eq(machines.id, machineId), eq(machines.companyId, companyId)));
}

/** Deshace el consumo de material de un trabajo (el stock de material es un balance exacto). */
async function revertJobMaterial(tx: DbOrTx, job: Pick<PrintJob, "id" | "companyId">): Promise<void> {
  const movements = await tx
    .select({ id: materialMovements.id })
    .from(materialMovements)
    .where(and(eq(materialMovements.printJobId, job.id), eq(materialMovements.companyId, job.companyId)));
  for (const m of movements) await revertMaterialMovement(tx, job.companyId, m.id);
}

/**
 * Cierra una impresión (o corrige una ya cerrada) aplicando energía, material,
 * horas y piezas. Sobre una impresión ya cerrada solo se aplica la diferencia.
 */
export async function finishPrintJob(tx: DbOrTx, input: FinishPrintJobInput): Promise<PrintJob> {
  const [job] = await tx
    .select()
    .from(printJobs)
    .where(and(eq(printJobs.id, input.jobId), eq(printJobs.companyId, input.companyId)))
    .limit(1);
  if (!job) throw new ActionError("La impresión no existe.");

  const wasClosed = job.endedAt !== null;
  const changes = input.changes ?? {};
  const productId = changes.productId !== undefined ? changes.productId : job.productId;
  const materialId = changes.materialId !== undefined ? changes.materialId : job.materialId;
  const orderId = changes.orderId !== undefined ? changes.orderId : job.orderId;

  const [company] = await tx.select().from(companies).where(eq(companies.id, input.companyId)).limit(1);
  const machine = job.machineId
    ? (await tx.select().from(machines).where(and(eq(machines.id, job.machineId), eq(machines.companyId, input.companyId))).limit(1))[0]
    : undefined;
  const material = materialId
    ? (await tx.select().from(materials).where(and(eq(materials.id, materialId), eq(materials.companyId, input.companyId))).limit(1))[0]
    : undefined;

  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const endedAt = input.endedAt.getTime() < job.startedAt.getTime() ? job.startedAt : input.endedAt;
  const wallSec = Math.max(0, Math.round((endedAt.getTime() - job.startedAt.getTime()) / 1000));
  const durationSec = Math.max(0, Math.round(input.durationSec ?? wallSec));
  const materialUsed = Math.max(0, input.materialUsed ?? job.materialUsed ?? 0);
  const piecesProduced = Math.max(0, Math.round(input.piecesProduced ?? job.piecesProduced ?? 0));
  const piecesFailed = Math.max(0, Math.round(input.piecesFailed ?? job.piecesFailed ?? 0));

  /* Energía. Una impresión ya cerrada conserva lo que costó en su día: solo se
     reescala si cambia la duración. Nunca se recalcula con la tarifa de hoy ni
     se pone a cero porque la máquina ya no exista. */
  let energy: { kwh: number; costCents: number };
  if (wasClosed && job.durationSec > 0 && (job.energyKwh > 0 || !machine)) {
    const factor = durationSec / job.durationSec;
    energy = factor === 1 ? { kwh: job.energyKwh, costCents: job.energyCostCents } : { kwh: job.energyKwh * factor, costCents: Math.round(job.energyCostCents * factor) };
  } else {
    energy = machine ? energyCost(company, { start: job.startedAt, durationSec, watts: machine.powerPrintW, timeZone }) : { kwh: 0, costCents: 0 };
  }

  /* Material: el stock de material es un balance exacto, así que deshacer el
     consumo anterior y aplicar el nuevo cuadra siempre. Si nada cambia no se toca. */
  const sameMaterial = wasClosed && materialId === job.materialId;
  if (!(sameMaterial && materialUsed === job.materialUsed)) {
    await revertJobMaterial(tx, job);
    if (material && materialUsed > 0) {
      await applyMaterialMovement(tx, {
        companyId: input.companyId,
        materialId: material.id,
        type: "consumption",
        qty: materialUsed,
        date: dateToISO(endedAt, timeZone),
        printJobId: job.id,
        note: `Impresión: ${changes.name ?? job.name}`,
      });
    }
  }
  // El coste del material tampoco se reprecia con el precio de hoy si no cambia el material.
  let materialCost: number;
  if (sameMaterial && materialUsed === job.materialUsed) materialCost = job.materialCostCents; // nada cambia (aunque el material ya no exista)
  else if (!material) materialCost = 0;
  else if (sameMaterial && job.materialUsed > 0 && job.materialCostCents > 0) materialCost = Math.round((job.materialCostCents * materialUsed) / job.materialUsed);
  else materialCost = materialCostCents(material, materialUsed);

  /* Horas de máquina: solo la diferencia. */
  if (machine) await addMachineSeconds(tx, input.companyId, machine.id, durationSec - (wasClosed ? job.durationSec : 0));

  /* Piezas al stock de producto: solo la diferencia (y de un producto a otro si cambia). */
  const oldPieces = wasClosed && job.productId ? job.piecesProduced : 0;
  if (productId === job.productId) {
    if (productId) await addProductStock(tx, input.companyId, productId, piecesProduced - oldPieces);
  } else {
    if (job.productId) await addProductStock(tx, input.companyId, job.productId, -oldPieces);
    if (productId) await addProductStock(tx, input.companyId, productId, piecesProduced);
  }

  const [updated] = await tx
    .update(printJobs)
    .set({
      ...(changes.name !== undefined ? { name: changes.name.trim().slice(0, 200) || "Impresión" } : {}),
      ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
      productId,
      orderId,
      materialId: material ? material.id : null,
      status: input.status,
      endedAt,
      durationSec,
      progress: input.status === "completed" ? 100 : job.progress,
      materialUsed,
      materialCostCents: materialCost,
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
  await revertJobMaterial(tx, job);
  if (job.endedAt && job.machineId) await addMachineSeconds(tx, companyId, job.machineId, -job.durationSec);
  if (job.endedAt && job.productId) await addProductStock(tx, companyId, job.productId, -job.piecesProduced);
  await tx.delete(printJobs).where(eq(printJobs.id, job.id));
}
