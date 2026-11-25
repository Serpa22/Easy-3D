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

/**
 * Prueba una conexión sin guardarla: conecta, espera la primera telemetría y desconecta.
 *
 * Los mensajes que devuelve son siempre textos fijos: nunca el error en bruto ni
 * fragmentos de la respuesta remota, para que la prueba no sirva para leer
 * servicios internos de la red del servidor.
 */
export async function testConnection(
  type: ConnectionType,
  config: Record<string, unknown>,
  meta?: { technology?: string },
): Promise<ConnectionTestResult> {
  if (type === "none") return { ok: false, message: "Esta máquina no tiene conexión configurada." };
  if (!embeddedEnabled()) {
    return {
      ok: false,
      message: "Esta instalación no se conecta directamente a las impresoras: lo hace el bridge del taller. Guarda la máquina y comprueba su estado en directo.",
    };
  }
  let adapter: Awaited<ReturnType<NonNullable<Awaited<ReturnType<typeof loadAdapter>>>>> | undefined;
  try {
    const factory = await loadAdapter(type);
    if (!factory) return { ok: false, message: "Tipo de conexión no disponible." };
    // Solo mensajes que redacta el propio adaptador (credenciales rechazadas, dirección no válida…).
    let lastError = "";
    const result = await new Promise<ConnectionTestResult>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          ok: false,
          message: `No se ha recibido respuesta de la impresora en 8 s. ${lastError || "Comprueba la dirección, que esté encendida y en la misma red."}`,
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
        log: () => {},
      });
      adapter.start();
    });
    return result;
  } catch (error) {
    console.error("[impresoras] prueba de conexión", error instanceof Error ? error.name : "error");
    return { ok: false, message: "No se pudo probar la conexión. Revisa los datos e inténtalo de nuevo." };
  } finally {
    await adapter?.stop().catch(() => {});
  }
}
