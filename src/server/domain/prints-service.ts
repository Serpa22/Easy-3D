/** Partes de impresión manuales y correcciones, como funciones de (db, empresa, datos). */
import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db, Tx } from "@/server/db";
import { machines, materials, orders, printJobs, products } from "@/server/db/schema";
import { parseLocalDateTime } from "@/lib/dates";
import { zInt, zOptionalDecimal, zOptionalId, zOptionalInt, zOptionalText, zText } from "@/lib/validation";
import { ActionError } from "@/server/action";
import { deletePrintJob, finishPrintJob, startPrintJob } from "./print-jobs";

const RESULT = ["completed", "failed", "cancelled"] as const;

const links = {
  productId: zOptionalId(),
  orderId: zOptionalId(),
  materialId: zOptionalId(),
};

export const startJobSchema = z.object({
  machineId: z.uuid("Elige una máquina"),
  name: zText(200),
  ...links,
  estimatedHours: zOptionalDecimal(0, { min: 0, max: 1000 }),
  estimatedMinutes: zOptionalDecimal(0, { min: 0, max: 59 }),
  notes: zOptionalText(2000),
});

const outcome = {
  status: z.enum(RESULT),
  materialUsed: zOptionalDecimal(0, { min: 0, max: 10_000_000 }),
  piecesProduced: zOptionalInt(0, { min: 0, max: 1_000_000 }),
  piecesFailed: zOptionalInt(0, { min: 0, max: 1_000_000 }),
  errorMessage: zOptionalText(300),
  notes: zOptionalText(2000),
};

export const logJobSchema = z.object({
  machineId: z.uuid("Elige una máquina"),
  name: zText(200),
  ...links,
  startedAt: z.string().min(1, "Indica el inicio"),
  endedAt: z.string().min(1, "Indica el fin"),
  ...outcome,
});

export const finishJobSchema = z.object({ jobId: z.uuid(), endedAt: z.string().optional(), ...outcome });
export const editJobSchema = z.object({ jobId: z.uuid(), name: zText(200), ...links, durationMinutes: zInt({ min: 0, max: 100_000 }), ...outcome });

/** Comprueba que máquina, producto, pedido y material pertenecen a la empresa. */
async function assertOwned(tx: Tx, companyId: string, ids: { machineId?: string | null; productId?: string | null; orderId?: string | null; materialId?: string | null }) {
  const check = async (ok: Promise<unknown[]>, field: string, label: string) => {
    if ((await ok).length === 0) throw new ActionError("Revisa los campos marcados.", { [field]: `${label} no válido` });
  };
  if (ids.machineId) await check(tx.select({ id: machines.id }).from(machines).where(and(eq(machines.id, ids.machineId), eq(machines.companyId, companyId))).limit(1), "machineId", "Máquina");
  if (ids.productId) await check(tx.select({ id: products.id }).from(products).where(and(eq(products.id, ids.productId), eq(products.companyId, companyId))).limit(1), "productId", "Producto");
  if (ids.orderId) await check(tx.select({ id: orders.id }).from(orders).where(and(eq(orders.id, ids.orderId), eq(orders.companyId, companyId))).limit(1), "orderId", "Pedido");
  if (ids.materialId) await check(tx.select({ id: materials.id }).from(materials).where(and(eq(materials.id, ids.materialId), eq(materials.companyId, companyId))).limit(1), "materialId", "Material");
}

/** Empieza ahora una impresión manual. Una máquina no puede tener dos abiertas. */
export async function startManualJob(db: Db, companyId: string, input: z.output<typeof startJobSchema>, now: Date) {
  return db.transaction(async (tx) => {
    await assertOwned(tx, companyId, input);
    const open = await tx
      .select({ id: printJobs.id })
      .from(printJobs)
      .where(and(eq(printJobs.companyId, companyId), eq(printJobs.machineId, input.machineId), isNull(printJobs.endedAt), inArray(printJobs.status, ["printing", "paused"])))
      .limit(1);
    if (open.length > 0) throw new ActionError("Esta máquina ya tiene una impresión en curso. Termínala antes de empezar otra.", { machineId: "Ya tiene una impresión en curso" });
    return startPrintJob(tx, {
      companyId,
      machineId: input.machineId,
      name: input.name,
      source: "manual",
      startedAt: now,
      materialId: input.materialId,
      productId: input.productId,
      orderId: input.orderId,
      estimatedSec: ((input.estimatedHours ?? 0) * 60 + (input.estimatedMinutes ?? 0)) * 60,
      notes: input.notes,
    });
  });
}

/** Apunta una impresión que ya terminó (inicio y fin en la zona horaria de la organización). */
export async function logFinishedJob(db: Db, companyId: string, input: z.output<typeof logJobSchema>, timeZone: string, now: Date) {
  const startedAt = parseLocalDateTime(input.startedAt, timeZone);
  const endedAt = parseLocalDateTime(input.endedAt, timeZone);
  if (!startedAt) throw new ActionError("Revisa los campos marcados.", { startedAt: "Fecha de inicio no válida" });
  if (!endedAt) throw new ActionError("Revisa los campos marcados.", { endedAt: "Fecha de fin no válida" });
  if (endedAt < startedAt) throw new ActionError("Revisa los campos marcados.", { endedAt: "El fin no puede ser anterior al inicio" });
  if (endedAt.getTime() > now.getTime() + 60_000) throw new ActionError("Revisa los campos marcados.", { endedAt: "No puede ser una fecha futura" });
  return db.transaction(async (tx) => {
    await assertOwned(tx, companyId, input);
    const job = await startPrintJob(tx, {
      companyId,
      machineId: input.machineId,
      name: input.name,
      source: "manual",
      startedAt,
      materialId: input.materialId,
      productId: input.productId,
      orderId: input.orderId,
      notes: input.notes,
    });
    return finishPrintJob(tx, {
      companyId,
      jobId: job.id,
      status: input.status,
      endedAt,
      materialUsed: input.materialUsed ?? 0,
      piecesProduced: input.status === "completed" ? (input.piecesProduced ?? 0) : 0,
      piecesFailed: input.piecesFailed ?? 0,
      errorMessage: input.status === "failed" ? input.errorMessage : null,
      timeZone,
    });
  });
}

/** Cierra una impresión abierta. */
export async function finishOpenJob(db: Db, companyId: string, input: z.output<typeof finishJobSchema>, timeZone: string, now: Date) {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(printJobs).where(and(eq(printJobs.id, input.jobId), eq(printJobs.companyId, companyId))).limit(1);
    if (!job) throw new ActionError("La impresión ya no existe.");
    if (job.endedAt) throw new ActionError("Esta impresión ya estaba cerrada.");
    const endedAt = (input.endedAt ? parseLocalDateTime(input.endedAt, timeZone) : null) ?? now;
    if (endedAt < job.startedAt) throw new ActionError("Revisa los campos marcados.", { endedAt: "El fin no puede ser anterior al inicio" });
    if (input.notes !== null) await tx.update(printJobs).set({ notes: input.notes }).where(eq(printJobs.id, job.id));
    return finishPrintJob(tx, {
      companyId,
      jobId: job.id,
      status: input.status,
      endedAt: endedAt.getTime() > now.getTime() ? now : endedAt,
      materialUsed: input.materialUsed ?? 0,
      piecesProduced: input.status === "completed" ? (input.piecesProduced ?? 0) : 0,
      piecesFailed: input.piecesFailed ?? 0,
      errorMessage: input.status === "failed" ? input.errorMessage : null,
      timeZone,
    });
  });
}

/** Corrige una impresión ya cerrada (producto, material, piezas, duración…). */
export async function updateClosedJob(db: Db, companyId: string, input: z.output<typeof editJobSchema>, timeZone: string) {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(printJobs).where(and(eq(printJobs.id, input.jobId), eq(printJobs.companyId, companyId))).limit(1);
    if (!job) throw new ActionError("La impresión ya no existe.");
    if (!job.endedAt) throw new ActionError("Esta impresión sigue en curso. Termínala primero.");
    await assertOwned(tx, companyId, input);
    // Una sola pasada: `finishPrintJob` aplica solo la diferencia respecto a lo ya contado.
    return finishPrintJob(tx, {
      companyId,
      jobId: job.id,
      status: input.status,
      endedAt: job.endedAt,
      // El formulario trabaja en minutos: si no se ha tocado, se conservan los segundos exactos.
      durationSec: input.durationMinutes === Math.round(job.durationSec / 60) ? job.durationSec : input.durationMinutes * 60,
      materialUsed: input.materialUsed ?? 0,
      piecesProduced: input.status === "completed" ? (input.piecesProduced ?? 0) : 0,
      piecesFailed: input.piecesFailed ?? 0,
      errorMessage: input.status === "failed" ? input.errorMessage : null,
      timeZone,
      changes: { name: input.name, notes: input.notes, productId: input.productId, orderId: input.orderId, materialId: input.materialId },
    });
  });
}

export async function removeJob(db: Db, companyId: string, jobId: string) {
  await db.transaction((tx) => deletePrintJob(tx, companyId, jobId));
}
