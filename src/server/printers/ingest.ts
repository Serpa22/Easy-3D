/**
 * Ingesta de telemetría: convierte lo que cuenta la impresora en hechos del
 * negocio. Actualiza el estado en directo, abre y cierra impresiones (con su
 * energía, material, horas y piezas, vía `domain/print-jobs`) y deja el rastro
 * de eventos de la máquina.
 */
import "server-only";
import { and, eq, lt } from "drizzle-orm";
import type { Db } from "@/server/db";
import { appSettings, machineEvents, machineLive, machines, materials, printJobs, type PrintJob } from "@/server/db/schema";
import { finishPrintJob, startPrintJob } from "@/server/domain/print-jobs";
import type { MachineEventType, PrinterState } from "@/lib/domain";
import { filamentMmToGrams } from "@/lib/filament";
import { DEFAULT_TIME_ZONE, formatDuration } from "@/lib/format";
import type { PrinterTelemetry } from "@/lib/telemetry";
import { sanitizeTelemetry } from "./adapters/_shared";
import type { TelemetryItem } from "./types";

const ACTIVE: readonly PrinterState[] = ["preparing", "printing", "paused"];
const isActive = (s: PrinterState) => ACTIVE.includes(s);

/* Zona horaria de la organización, leída sin React `cache` (esto corre fuera de peticiones). */
let tzCache: { value: string; at: number } | undefined;
async function orgTimeZone(db: Db): Promise<string> {
  if (tzCache && Date.now() - tzCache.at < 60_000) return tzCache.value;
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "org")).limit(1);
  const value = (row?.value as { timeZone?: string } | undefined)?.timeZone || DEFAULT_TIME_ZONE;
  tzCache = { value, at: Date.now() };
  return value;
}

/* Una cola por máquina: dos telemetrías de la misma máquina nunca se pisan. */
const queues: Map<string, Promise<void>> = ((globalThis as unknown as { __e3dIngest?: Map<string, Promise<void>> }).__e3dIngest ??= new Map());

export function applyTelemetry(db: Db, item: TelemetryItem): Promise<void> {
  const previous = queues.get(item.machineId) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => processItem(db, item))
    .finally(() => {
      if (queues.get(item.machineId) === next) queues.delete(item.machineId);
    });
  queues.set(item.machineId, next);
  return next;
}

interface NewEvent {
  type: MachineEventType;
  message: string;
  data?: Record<string, unknown>;
  printJobId?: string | null;
}

async function processItem(db: Db, item: TelemetryItem): Promise<void> {
  const parsed = new Date(item.at);
  const now = new Date();
  const at = Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime() ? now : parsed;
  const t = sanitizeTelemetry(item.telemetry);
  const timeZone = await orgTimeZone(db);

  await db.transaction(async (tx) => {
    const [machine] = await tx
      .select({ id: machines.id, companyId: machines.companyId, connectionType: machines.connectionType })
      .from(machines)
      .where(eq(machines.id, item.machineId))
      .limit(1);
    if (!machine || machine.connectionType === "none") return;

    const [live] = await tx.select().from(machineLive).where(eq(machineLive.machineId, machine.id)).limit(1);
    if (live?.updatedAt && at.getTime() < live.updatedAt.getTime()) return; // llegó tarde

    const prev: PrinterState = live?.state ?? "offline";
    const next = t.state;
    const prevTelemetry: PrinterTelemetry | null = live?.telemetry ?? null;
    const events: NewEvent[] = [];

    let job: PrintJob | undefined;
    if (live?.currentJobId) {
      [job] = await tx
        .select()
        .from(printJobs)
        .where(and(eq(printJobs.id, live.currentJobId), eq(printJobs.companyId, machine.companyId)))
        .limit(1);
      if (job?.endedAt) job = undefined; // la cerraron a mano
    }

    const title = t.job?.title || t.job?.fileName || "Impresión";

    const closeJob = async (status: "completed" | "failed" | "cancelled", errorMessage?: string) => {
      if (!job) return;
      const facts = t.job ?? prevTelemetry?.job;
      const wallSec = Math.max(0, Math.round((at.getTime() - job.startedAt.getTime()) / 1000));
      const elapsed = facts?.elapsedSec;
      const durationSec = elapsed && elapsed > 0 && elapsed <= wallSec * 1.1 + 120 ? elapsed : wallSec;

      // Material: solo si la impresora lo mide y el material del trabajo va en gramos.
      let materialUsed: number | undefined;
      if (job.materialId && (facts?.filamentUsedG !== undefined || facts?.filamentUsedMm !== undefined)) {
        const [material] = await tx
          .select({ unit: materials.unit, materialType: materials.materialType })
          .from(materials)
          .where(and(eq(materials.id, job.materialId), eq(materials.companyId, machine.companyId)))
          .limit(1);
        if (material?.unit === "g") {
          materialUsed = facts.filamentUsedG ?? filamentMmToGrams(facts.filamentUsedMm ?? 0, material.materialType);
          materialUsed = Math.round(materialUsed * 10) / 10;
        }
      }
      const closed = await finishPrintJob(tx, {
        companyId: machine.companyId,
        jobId: job.id,
        status,
        endedAt: at,
        durationSec,
        materialUsed,
        errorMessage: errorMessage ?? null,
        timeZone,
      });
      const type: MachineEventType = status === "completed" ? "print_finished" : status === "failed" ? "print_failed" : "print_cancelled";
      const what = status === "completed" ? "terminada" : status === "failed" ? "fallida" : "cancelada";
      events.push({
        type,
        message: `«${job.name}» ${what} tras ${formatDuration(durationSec)}${errorMessage ? `: ${errorMessage}` : ""}`,
        data: { durationSec, materialUsed: closed.materialUsed, energyKwh: closed.energyKwh, progress: closed.progress },
        printJobId: job.id,
      });
      job = undefined;
    };

    if (live && prev === "offline" && next !== "offline") events.push({ type: "online", message: "Conexión recuperada" });
    if (!live && next !== "offline") events.push({ type: "online", message: "Máquina conectada por primera vez" });
    if (prev !== "offline" && next === "offline") events.push({ type: "offline", message: "Se ha perdido la conexión con la máquina" });

    if (next === "offline") {
      // Se mantiene la impresión abierta: puede ser solo un corte de red.
    } else if (isActive(next)) {
      if (job && t.job) {
        const sameFile = t.job.fileName ? t.job.fileName === job.fileName : title === job.name;
        const wentBack = job.progress - (t.job.progress ?? job.progress) > 20;
        if (!sameFile && wentBack) await closeJob(job.progress >= 99.5 ? "completed" : "cancelled");
      }
      if (!job) {
        const estimated = t.job?.remainingSec !== undefined ? (t.job.elapsedSec ?? 0) + t.job.remainingSec : undefined;
        job = await startPrintJob(tx, {
          companyId: machine.companyId,
          machineId: machine.id,
          name: title,
          fileName: t.job?.fileName ?? null,
          source: "live",
          startedAt: at,
          estimatedSec: estimated,
          thumbnailUrl: t.job?.thumbnailUrl ?? null,
        });
        if (next === "paused") await tx.update(printJobs).set({ status: "paused" }).where(eq(printJobs.id, job.id));
        events.push({ type: "print_started", message: `«${job.name}»`, printJobId: job.id });
      } else {
        const patch: Partial<typeof printJobs.$inferInsert> = {};
        if (next === "paused" && job.status !== "paused") {
          patch.status = "paused";
          events.push({ type: "print_paused", message: `Impresión en pausa${t.stateDetail ? `: ${t.stateDetail}` : ""}`, printJobId: job.id });
        } else if (next !== "paused" && job.status === "paused") {
          patch.status = "printing";
          events.push({ type: "print_resumed", message: "Impresión reanudada", printJobId: job.id });
        }
        const progress = t.job?.progress;
        if (progress !== undefined && Math.abs(progress - job.progress) >= 1) patch.progress = progress;
        if (t.job?.thumbnailUrl && t.job.thumbnailUrl !== job.thumbnailUrl) patch.thumbnailUrl = t.job.thumbnailUrl;
        if (Object.keys(patch).length > 0) await tx.update(printJobs).set(patch).where(eq(printJobs.id, job.id));
      }
    } else if (job) {
      if (next === "finished") await closeJob("completed");
      else if (next === "error") await closeJob("failed", t.errors?.[0]?.message ?? "La impresora informó de un error");
      else await closeJob(Math.max(job.progress, t.job?.progress ?? 0) >= 99.5 ? "completed" : "cancelled");
    }

    // Errores nuevos (sin repetir el que ya explica una impresión fallida).
    const known = new Set((prevTelemetry?.errors ?? []).map((e) => e.message));
    const failedMessage = events.find((e) => e.type === "print_failed")?.message ?? "";
    for (const error of t.errors ?? []) {
      if (known.has(error.message) || failedMessage.includes(error.message)) continue;
      events.push({ type: "error", message: error.code ? `${error.message} (${error.code})` : error.message, printJobId: job?.id ?? null });
    }

    const stateSince = !live || live.state !== next ? at : (live.stateSince ?? at);
    const currentJobId = job?.id ?? null;
    await tx
      .insert(machineLive)
      .values({ machineId: machine.id, companyId: machine.companyId, state: next, telemetry: t, currentJobId, updatedAt: at, stateSince })
      .onConflictDoUpdate({
        target: machineLive.machineId,
        set: { companyId: machine.companyId, state: next, telemetry: t, currentJobId, updatedAt: at, stateSince },
      });

    if (events.length > 0) {
      await tx.insert(machineEvents).values(
        events.map((e, i) => ({
          companyId: machine.companyId,
          machineId: machine.id,
          type: e.type,
          message: e.message.slice(0, 500),
          data: e.data ?? null,
          printJobId: e.printJobId ?? null,
          // Un milisegundo de separación mantiene el orden dentro del mismo lote.
          createdAt: new Date(at.getTime() + i),
        })),
      );
      // Limpieza ocasional del historial de eventos (90 días).
      if (Math.random() < 0.02) {
        await tx.delete(machineEvents).where(and(eq(machineEvents.machineId, machine.id), lt(machineEvents.createdAt, new Date(at.getTime() - 90 * 86_400_000))));
      }
    }
  });
}
