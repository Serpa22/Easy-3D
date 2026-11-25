/**
 * Modo embebido: cuando la app corre como servidor normal (PC, mini-PC o
 * Raspberry Pi en la misma red que las impresoras) se conecta ella misma a las
 * máquinas, sin programa puente.
 */
import "server-only";
import { and, isNull, ne } from "drizzle-orm";
import { getDb } from "@/server/db";
import { logError } from "@/server/log";
import { machines } from "@/server/db/schema";
import { applyTelemetry } from "./ingest";
import { PrinterManager } from "./manager";

interface Holder {
  manager?: PrinterManager;
  started?: boolean;
  timer?: ReturnType<typeof setInterval>;
  syncing?: Promise<void>;
}
const holder: Holder = ((globalThis as unknown as { __e3dPrinters?: Holder }).__e3dPrinters ??= {});

export function embeddedEnabled(): boolean {
  if (process.env.E3D_EMBEDDED_PRINTERS === "false") return false;
  if (process.env.E3D_EMBEDDED_PRINTERS === "true") return true;
  // En plataformas serverless no hay proceso de larga duración.
  return !process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME;
}

/** Recarga la lista de máquinas y ajusta las conexiones. */
export async function syncEmbeddedPrinters(): Promise<void> {
  if (!embeddedEnabled() || !holder.started) return;
  if (holder.syncing) return holder.syncing;
  holder.syncing = (async () => {
    try {
      const db = await getDb();
      holder.manager ??= new PrinterManager(
        {
          deliver: async (items) => {
            for (const item of items) {
              await applyTelemetry(db, item).catch((error) => logError("impresoras · ingesta", error));
            }
          },
        },
        (level, message) => (level === "info" ? undefined : console[level](`[impresoras] ${message}`)),
      );
      const rows = await db
        .select({ id: machines.id, name: machines.name, technology: machines.technology, connectionType: machines.connectionType, config: machines.connectionConfig })
        .from(machines)
        .where(and(ne(machines.connectionType, "none"), isNull(machines.bridgeId), ne(machines.status, "retired")));
      await holder.manager.sync(rows.map((m) => ({ id: m.id, connectionType: m.connectionType, config: m.config ?? {}, meta: { name: m.name, technology: m.technology } })));
    } catch (error) {
      logError("impresoras · sincronización", error);
    } finally {
      holder.syncing = undefined;
    }
  })();
  return holder.syncing;
}

/** Arranca el modo embebido (una sola vez por proceso). No bloquea el arranque del servidor. */
export function startEmbeddedPrinters(): void {
  if (holder.started || !embeddedEnabled()) return;
  holder.started = true;
  const first = setTimeout(() => void syncEmbeddedPrinters(), 1500);
  first.unref?.();
  // Resincroniza por si algo cambió sin aviso (y reintenta si la BD no estaba lista).
  holder.timer = setInterval(() => void syncEmbeddedPrinters(), 60_000);
  holder.timer.unref?.();
}
