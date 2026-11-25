/**
 * Punto de entrada del subsistema de impresoras para el resto de la app.
 * (Las acciones de máquinas solo deben importar de aquí.)
 */
import "server-only";
import type { ConnectionType } from "@/lib/domain";
import type { PrinterTelemetry } from "@/lib/telemetry";

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
export async function notifyMachineChanged(machineId: string): Promise<void> {
  void machineId; // Implementación provisional.
}

/** Prueba una conexión sin guardarla: conecta, espera la primera telemetría y desconecta. */
export async function testConnection(type: ConnectionType, config: Record<string, unknown>): Promise<ConnectionTestResult> {
  void type;
  void config;
  return { ok: false, message: "La conexión con impresoras todavía no está disponible." };
}
