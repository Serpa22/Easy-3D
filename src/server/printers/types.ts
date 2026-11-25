/**
 * Contrato de los adaptadores de impresora.
 *
 * IMPORTANTE: este archivo, `manager.ts`, `registry.ts` y `adapters/**` se
 * ejecutan también fuera de Next (en el programa «bridge»), así que no pueden
 * importar `server-only`, `next/*` ni alias `@/`: solo rutas relativas.
 */
import type { ConnectionType } from "../../lib/domain";
import type { PrinterTelemetry } from "../../lib/telemetry";

export interface AdapterContext {
  machineId: string;
  /** Datos de conexión (host, claves…) tal y como se guardaron. */
  config: Record<string, unknown>;
  /** Datos de la máquina que pueden orientar al adaptador. */
  meta?: { name?: string; technology?: string };
  /** Llamar con cada actualización; el gestor se encarga de dosificar los envíos. */
  onTelemetry(telemetry: PrinterTelemetry): void;
  log(level: "info" | "warn" | "error", message: string): void;
}

export interface PrinterAdapter {
  /** Empieza a conectar. Nunca lanza: reintenta sola y emite `offline` si pierde el enlace. */
  start(): void;
  stop(): Promise<void>;
}

export type AdapterFactory = (ctx: AdapterContext) => PrinterAdapter;

export interface ManagedMachine {
  id: string;
  connectionType: ConnectionType;
  config: Record<string, unknown>;
  meta?: AdapterContext["meta"];
}

export interface TelemetryItem {
  machineId: string;
  telemetry: PrinterTelemetry;
  /** ISO 8601 */
  at: string;
}

export interface TelemetrySink {
  deliver(items: TelemetryItem[]): Promise<void>;
}
