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

type JobFacts = NonNullable<PrinterTelemetry["job"]>;
/** Sin noticias de la impresión durante más de este tiempo = hubo un corte y no se vio cómo acabó. */
const OUTAGE_SEC = 180;
/** Si tras un corte no hay ningún dato para estimar cuánto siguió imprimiendo, se cuenta como mucho esto. */
const MAX_BLIND_SEC = 30 * 60;

export interface JobClosure {
  status: "completed" | "failed" | "cancelled";
  endedAt: Date;
  durationSec: number;
  /** Datos estimados porque la impresión acabó sin que la app la estuviera viendo. */
  estimated: boolean;
  /** Factor por el que multiplicar el material medido (extrapolación hasta el 100 %). */
  materialFactor: number;
}

/**
 * Decide cómo se cierra una impresión seguida en directo. Función pura.
 *
 * - `last`: lo último que se supo de ESTA impresión y cuándo.
 * - `current`: datos del mensaje actual, solo si siguen hablando de esta impresión
 *   (nunca los de la impresión siguiente).
 * - `how`: resultado conocido, o "auto" para deducirlo del progreso.
 */
export function resolveJobClosure(input: {
  startedAt: Date;
  at: Date;
  jobProgress: number;
  last: { at: Date; facts: JobFacts } | null;
  current: JobFacts | null;
  how: "completed" | "failed" | "cancelled" | "auto";
  /** Progreso a partir del cual «auto» la da por completada. */
  completeFrom?: number;
}): JobClosure {
  const { startedAt, at, last, current } = input;
  const wallSec = Math.max(0, Math.round((at.getTime() - startedAt.getTime()) / 1000));
  const valid = (elapsed: number | undefined) => (elapsed !== undefined && elapsed > 0 && elapsed <= wallSec * 1.1 + 120 ? elapsed : undefined);
  const progress = Math.max(input.jobProgress, last?.facts.progress ?? 0, current?.progress ?? 0);
  const gapSec = last ? Math.max(0, (at.getTime() - last.at.getTime()) / 1000) : 0;
  const finalElapsed = valid(current?.elapsedSec);

  // Caso normal: se ha seguido la impresión hasta el final (o la impresora dice cuánto duró).
  if (!last || gapSec <= OUTAGE_SEC) {
    const status = input.how !== "auto" ? input.how : progress >= (input.completeFrom ?? 99.5) ? "completed" : "cancelled";
    return { status, endedAt: at, durationSec: Math.round(finalElapsed ?? valid(last?.facts.elapsedSec) ?? wallSec), estimated: false, materialFactor: 1 };
  }

  // Hubo un corte: no se sabe cuándo terminó. Como mucho duró lo que le quedaba al perderla de vista.
  const lastElapsed = valid(last.facts.elapsedSec) ?? Math.max(0, (last.at.getTime() - startedAt.getTime()) / 1000);
  const remaining = last.facts.remainingSec;
  const lastPct = last.facts.progress ?? 0;
  // Tiempo que siguió imprimiendo durante el corte, de lo más fiable a lo menos:
  // lo que diga la impresora, lo que le quedaba, lo que se deduce de su ritmo, o un tope prudente.
  const byPace = lastPct > 0 && lastElapsed > 0 ? (lastElapsed * (100 - lastPct)) / lastPct : undefined;
  const extra =
    finalElapsed !== undefined
      ? Math.max(0, Math.min(gapSec, finalElapsed - lastElapsed))
      : Math.min(gapSec, remaining ?? byPace ?? MAX_BLIND_SEC);
  const hadTimeToFinish = remaining !== undefined ? gapSec >= remaining : progress >= 95;
  const status = input.how !== "auto" ? input.how : progress >= 99.5 || hadTimeToFinish ? "completed" : "cancelled";
  const lastProgress = last.facts.progress ?? 0;
  // Si se da por completada, el material medido al 60 % se extrapola al 100 % (solo si el dato es fiable).
  const materialFactor = status === "completed" && current?.filamentUsedG === undefined && current?.filamentUsedMm === undefined && lastProgress >= 50 && lastProgress < 99.5 ? 100 / lastProgress : 1;
  return {
    status,
    endedAt: new Date(Math.min(at.getTime(), last.at.getTime() + extra * 1000)),
    durationSec: Math.round(finalElapsed ?? lastElapsed + extra),
    estimated: true,
    materialFactor,
  };
}

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

    // Lo último que se supo de la impresión abierta (sobrevive a los cortes de conexión).
    let last: { at: Date; facts: JobFacts } | null = null;
    if (job) {
      if (live?.lastJob) last = { at: new Date(live.lastJob.at), facts: live.lastJob.facts };
      else if (prevTelemetry?.job && live?.updatedAt) last = { at: live.updatedAt, facts: prevTelemetry.job };
    }

    /**
     * Cierra la impresión abierta con SUS datos. `useCurrent` indica si el mensaje
     * actual todavía describe esa impresión (p. ej. «terminada») o ya habla de otra.
     */
    const closeJob = async (how: "completed" | "failed" | "cancelled" | "auto", opts: { useCurrent: boolean; errorMessage?: string; completeFrom?: number }) => {
      if (!job) return;
      const current = opts.useCurrent ? (t.job ?? null) : null;
      const closure = resolveJobClosure({ startedAt: job.startedAt, at, jobProgress: job.progress, last, current, how, completeFrom: opts.completeFrom });
      const facts: JobFacts = { ...(last?.facts ?? {}), ...(current ?? {}) };

      // Material: solo si la impresora lo mide y el material del trabajo va en gramos.
      let materialUsed: number | undefined;
      if (job.materialId && (facts.filamentUsedG !== undefined || facts.filamentUsedMm !== undefined)) {
        const [material] = await tx
          .select({ unit: materials.unit, materialType: materials.materialType })
          .from(materials)
          .where(and(eq(materials.id, job.materialId), eq(materials.companyId, machine.companyId)))
          .limit(1);
        if (material?.unit === "g") {
          materialUsed = (facts.filamentUsedG ?? filamentMmToGrams(facts.filamentUsedMm ?? 0, material.materialType)) * closure.materialFactor;
          materialUsed = Math.round(materialUsed * 10) / 10;
        }
      }
      const closed = await finishPrintJob(tx, {
        companyId: machine.companyId,
        jobId: job.id,
        status: closure.status,
        endedAt: closure.endedAt,
        durationSec: closure.durationSec,
        materialUsed,
        errorMessage: opts.errorMessage ?? null,
        timeZone,
      });
      const { status, durationSec } = closure;
      const type: MachineEventType = status === "completed" ? "print_finished" : status === "failed" ? "print_failed" : "print_cancelled";
      const what = status === "completed" ? "terminada" : status === "failed" ? "fallida" : "cancelada";
      events.push({
        type,
        message: `«${job.name}» ${what} tras ${formatDuration(durationSec)}${opts.errorMessage ? `: ${opts.errorMessage}` : ""}${closure.estimated ? " (acabó sin conexión: duración y material estimados)" : ""}`,
        data: { durationSec, materialUsed: closed.materialUsed, energyKwh: closed.energyKwh, progress: closed.progress, estimated: closure.estimated },
        printJobId: job.id,
      });
      job = undefined;
      last = null;
    };

    if (live && prev === "offline" && next !== "offline") events.push({ type: "online", message: "Conexión recuperada" });
    if (!live && next !== "offline") events.push({ type: "online", message: "Máquina conectada por primera vez" });
    if (prev !== "offline" && next === "offline") events.push({ type: "offline", message: "Se ha perdido la conexión con la máquina" });

    if (next === "offline") {
      // Se mantiene la impresión abierta: puede ser solo un corte de red.
    } else if (isActive(next)) {
      if (job && t.job) {
        // ¿El mensaje habla de OTRA impresión? Archivo distinto, o el mismo archivo empezado de nuevo.
        const differentFile = Boolean(t.job.fileName && job.fileName && t.job.fileName !== job.fileName);
        const before = last?.facts;
        const restarted =
          t.job.progress !== undefined
            ? job.progress - t.job.progress > 20
            : before?.elapsedSec !== undefined && t.job.elapsedSec !== undefined && before.elapsedSec - t.job.elapsedSec > 300;
        // Se cierra con lo último que se supo de ella, nunca con los datos de la nueva.
        if (differentFile || restarted) await closeJob("auto", { useCurrent: false, completeFrom: 95 });
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
        // Estado y progreso iniciales (la app puede empezar a verla a medias).
        const initial: Partial<typeof printJobs.$inferInsert> = {};
        if (next === "paused") initial.status = "paused";
        if (t.job?.progress) initial.progress = t.job.progress;
        if (Object.keys(initial).length > 0) [job] = await tx.update(printJobs).set(initial).where(eq(printJobs.id, job.id)).returning();
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
        // El nombre del archivo a veces llega unos segundos después de empezar.
        if (!job.fileName && t.job?.fileName) {
          patch.fileName = t.job.fileName;
          if (job.name === "Impresión") patch.name = title.slice(0, 200);
        }
        if (t.job?.thumbnailUrl && t.job.thumbnailUrl !== job.thumbnailUrl) patch.thumbnailUrl = t.job.thumbnailUrl;
        if (Object.keys(patch).length > 0) await tx.update(printJobs).set(patch).where(eq(printJobs.id, job.id));
      }
    } else if (job) {
      // La impresora ya no imprime. El mensaje aún describe esta impresión salvo que nombre otro archivo.
      const useCurrent = !(t.job?.fileName && job.fileName && t.job.fileName !== job.fileName);
      if (next === "finished") await closeJob("completed", { useCurrent });
      else if (next === "error") await closeJob("failed", { useCurrent, errorMessage: t.errors?.[0]?.message ?? "La impresora informó de un error" });
      else await closeJob("auto", { useCurrent });
    }

    // Se guarda lo último que se sabe de la impresión abierta para poder cerrarla bien más adelante.
    const lastJob = job ? (isActive(next) && t.job ? { at: at.toISOString(), facts: t.job } : last ? { at: last.at.toISOString(), facts: last.facts } : null) : null;

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
      .values({ machineId: machine.id, companyId: machine.companyId, state: next, telemetry: t, currentJobId, lastJob, updatedAt: at, stateSince })
      .onConflictDoUpdate({
        target: machineLive.machineId,
        set: { companyId: machine.companyId, state: next, telemetry: t, currentJobId, lastJob, updatedAt: at, stateSince },
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
