import type { PrinterState } from "./domain";

/**
 * Telemetría normalizada de una impresora 3D, igual para cualquier marca.
 * Cada adaptador (Bambu, Moonraker, OctoPrint, PrusaLink, Elegoo, simulador)
 * traduce su protocolo a esta forma. Es JSON puro: se guarda tal cual en
 * `machine_live.telemetry` y se envía al navegador.
 */
export interface Temperature {
  current: number;
  target?: number;
}

export interface TelemetryJob {
  /** Nombre del archivo (gcode / 3mf). */
  fileName?: string;
  /** Nombre legible del trabajo si el protocolo lo tiene. */
  title?: string;
  /** 0..100 */
  progress?: number;
  layer?: number;
  totalLayers?: number;
  elapsedSec?: number;
  remainingSec?: number;
  filamentUsedMm?: number;
  filamentUsedG?: number;
  thumbnailUrl?: string;
}

export interface TelemetryFilament {
  /** Identificador del hueco: «AMS 1 · 2», «Externo», «T0»… */
  slot: string;
  /** PLA, PETG, ABS… */
  type?: string;
  /** #RRGGBB */
  color?: string;
  name?: string;
  /** 0..100 */
  remainingPct?: number;
  active?: boolean;
}

export interface TelemetryError {
  code?: string;
  message: string;
}

export interface PrinterTelemetry {
  state: PrinterState;
  /** Subestado en texto: «Nivelando cama», «Calentando»… */
  stateDetail?: string;
  job?: TelemetryJob;
  temps?: {
    nozzle?: Temperature;
    bed?: Temperature;
    chamber?: Temperature;
  };
  /** Porcentaje de velocidad (100 = normal). */
  speedPct?: number;
  /** Ventilador de capa, 0..100. */
  fanPct?: number;
  filament?: TelemetryFilament[];
  errors?: TelemetryError[];
  /** Potencia real en vatios, solo si el equipo la mide. */
  powerW?: number;
  firmware?: string;
  /** URL de cámara (snapshot o stream) accesible en la red local. */
  cameraUrl?: string;
}

/** Estado en directo de una máquina tal y como lo recibe la interfaz. */
export interface LiveMachine {
  machineId: string;
  companyId: string;
  /**
   * «live»: la máquina tiene conexión configurada y el estado viene de ella.
   * «manual»: sin conexión; el estado se deduce de las impresiones apuntadas a mano.
   */
  source: "live" | "manual";
  state: PrinterState;
  telemetry: PrinterTelemetry | null;
  /** ISO 8601. Última vez que se recibió telemetría (null en manuales o si nunca conectó). */
  updatedAt: string | null;
  /** ISO 8601. Desde cuándo está en el estado actual. */
  stateSince: string | null;
  /** Trabajo de impresión abierto asociado, si lo hay. */
  currentJobId: string | null;
}

export interface LiveSnapshot {
  machines: LiveMachine[];
  /** ISO 8601 del servidor (para calcular tiempos relativos sin depender del reloj del cliente). */
  serverTime: string;
}

/** Segundos sin telemetría tras los que una máquina conectada se considera «sin conexión». */
export const LIVE_STALE_SECONDS = 45;

export const EMPTY_TELEMETRY: PrinterTelemetry = { state: "offline" };
