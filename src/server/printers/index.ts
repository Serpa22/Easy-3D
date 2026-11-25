/**
 * Punto de entrada del subsistema de impresoras para el resto de la app.
 * (Las acciones de máquinas solo deben importar de aquí.)
 */
import "server-only";
import type { ConnectionType } from "@/lib/domain";
import { PRINTER_STATE_LABELS } from "@/lib/domain";
import type { PrinterTelemetry } from "@/lib/telemetry";
import { sanitizeTelemetry } from "./adapters/_shared";
import { embeddedEnabled, startEmbeddedPrinters, syncEmbeddedPrinters } from "./embedded";
import { loadAdapter } from "./registry";

export interface ConnectionTestResult {
  ok: boolean;
  /** Mensaje para el usuario, en español. */
  message: string;
  telemetry?: PrinterTelemetry;
}

/**
 * Avisa al gestor de conexiones de que una máquina se ha creado, cambiado o
 * borrado, para que (re)conecte o desconecte. Llamar después de guardar.
 */
export async function notifyMachineChanged(machineId?: string): Promise<void> {
  void machineId;
  if (!embeddedEnabled()) return;
  startEmbeddedPrinters();
  await syncEmbeddedPrinters();
}

/** Prueba una conexión sin guardarla: conecta, espera la primera telemetría y desconecta. */
export async function testConnection(
  type: ConnectionType,
  config: Record<string, unknown>,
  meta?: { technology?: string },
): Promise<ConnectionTestResult> {
  if (type === "none") return { ok: false, message: "Esta máquina no tiene conexión configurada." };
  let adapter: Awaited<ReturnType<NonNullable<Awaited<ReturnType<typeof loadAdapter>>>>> | undefined;
  try {
    const factory = await loadAdapter(type);
    if (!factory) return { ok: false, message: "Tipo de conexión no disponible." };
    let lastLog = "";
    let lastError = "";
    const result = await new Promise<ConnectionTestResult>((resolve) => {
      const timeout = setTimeout(() => {
        const detail = lastError || lastLog;
        resolve({
          ok: false,
          message: `No se ha recibido respuesta de la impresora en 8 s.${detail ? ` ${detail}` : " Comprueba la dirección, que esté encendida y en la misma red."}`,
        });
      }, 8000);
      adapter = factory({
        machineId: "test",
        config,
        meta,
        onTelemetry: (raw) => {
          const telemetry = sanitizeTelemetry(raw);
          if (telemetry.state === "offline") {
            if (telemetry.errors?.[0]) lastError = telemetry.errors[0].message;
            return;
          }
          clearTimeout(timeout);
          resolve({ ok: true, message: `Conexión correcta. Estado: ${PRINTER_STATE_LABELS[telemetry.state].toLowerCase()}.`, telemetry });
        },
        log: (level, message) => {
          if (level !== "info") lastLog = message;
        },
      });
      adapter.start();
    });
    return result;
  } catch (error) {
    return { ok: false, message: `No se pudo probar la conexión: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    await adapter?.stop().catch(() => {});
  }
}
