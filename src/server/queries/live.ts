/**
 * Estado en directo de las máquinas.
 *
 *  - Máquinas con conexión: última telemetría de `machine_live`; si lleva
 *    demasiado sin actualizarse se muestra como «sin conexión».
 *  - Máquinas sin conexión (manuales): «imprimiendo» si tienen una impresión
 *    manual abierta (con progreso estimado por tiempo), si no «en reposo».
 */
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { machineLive, machines, printJobs } from "@/server/db/schema";
import { LIVE_STALE_SECONDS, type LiveMachine, type LiveSnapshot, type PrinterTelemetry } from "@/lib/telemetry";

export async function getLiveMachines(
  db: DbOrTx,
  scope: { companyId?: string; machineId?: string } = {},
  now: Date = new Date(),
): Promise<LiveMachine[]> {
  const conditions = [];
  if (scope.companyId) conditions.push(eq(machines.companyId, scope.companyId));
  if (scope.machineId) conditions.push(eq(machines.id, scope.machineId));

  const rows = await db
    .select({
      machineId: machines.id,
      companyId: machines.companyId,
      connectionType: machines.connectionType,
      liveState: machineLive.state,
      telemetry: machineLive.telemetry,
      updatedAt: machineLive.updatedAt,
      stateSince: machineLive.stateSince,
      currentJobId: machineLive.currentJobId,
    })
    .from(machines)
    .leftJoin(machineLive, eq(machineLive.machineId, machines.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(machines.sortOrder, machines.createdAt);

  const manualIds = rows.filter((r) => r.connectionType === "none").map((r) => r.machineId);
  const openManualJobs = manualIds.length
    ? await db
        .select({
          id: printJobs.id,
          machineId: printJobs.machineId,
          name: printJobs.name,
          fileName: printJobs.fileName,
          status: printJobs.status,
          startedAt: printJobs.startedAt,
          estimatedSec: printJobs.estimatedSec,
          progress: printJobs.progress,
        })
        .from(printJobs)
        .where(and(inArray(printJobs.machineId, manualIds), inArray(printJobs.status, ["printing", "paused"])))
    : [];
  const jobByMachine = new Map(openManualJobs.map((j) => [j.machineId, j]));

  return rows.map((row): LiveMachine => {
    if (row.connectionType === "none") {
      const job = jobByMachine.get(row.machineId);
      if (!job) {
        return {
          machineId: row.machineId,
          companyId: row.companyId,
          source: "manual",
          state: "idle",
          telemetry: { state: "idle" },
          updatedAt: null,
          stateSince: null,
          currentJobId: null,
        };
      }
      const elapsedSec = Math.max(0, Math.round((now.getTime() - job.startedAt.getTime()) / 1000));
      const estimated = job.estimatedSec && job.estimatedSec > 0 ? job.estimatedSec : 0;
      const state = job.status === "paused" ? "paused" : "printing";
      const telemetry: PrinterTelemetry = {
        state,
        job: {
          title: job.name,
          fileName: job.fileName ?? undefined,
          elapsedSec,
          ...(estimated > 0
            ? {
                progress: Math.min(99, Math.round((elapsedSec / estimated) * 100)),
                remainingSec: Math.max(0, estimated - elapsedSec),
              }
            : {}),
        },
      };
      return {
        machineId: row.machineId,
        companyId: row.companyId,
        source: "manual",
        state,
        telemetry,
        updatedAt: null,
        stateSince: job.startedAt.toISOString(),
        currentJobId: job.id,
      };
    }

    const stale = !row.updatedAt || now.getTime() - row.updatedAt.getTime() > LIVE_STALE_SECONDS * 1000;
    const state = stale ? "offline" : (row.liveState ?? "offline");
    return {
      machineId: row.machineId,
      companyId: row.companyId,
      source: "live",
      state,
      telemetry: row.telemetry ? { ...row.telemetry, state } : { state },
      updatedAt: row.updatedAt?.toISOString() ?? null,
      stateSince: row.stateSince?.toISOString() ?? null,
      currentJobId: row.currentJobId ?? null,
    };
  });
}

export async function getLiveSnapshot(db: DbOrTx, scope: { companyId?: string } = {}): Promise<LiveSnapshot> {
  const now = new Date();
  return { machines: await getLiveMachines(db, scope, now), serverTime: now.toISOString() };
}
