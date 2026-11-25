/**
 * Gestor de conexiones: mantiene un adaptador por máquina y dosifica el envío
 * de telemetría hacia un destino (la BD en modo embebido, la API en el bridge).
 * Node puro: lo usan tanto el servidor como el programa «bridge».
 */
import type { PrinterTelemetry } from "../../lib/telemetry";
import { loadAdapter } from "./registry";
import type { ManagedMachine, PrinterAdapter, TelemetryItem, TelemetrySink } from "./types";

const MIN_INTERVAL_MS = 2000;
const HEARTBEAT_MS = 15_000;
const FLUSH_MS = 500;

interface Entry {
  key: string;
  adapter: PrinterAdapter | null;
  last?: PrinterTelemetry;
  lastSentAt: number;
  lastSignature?: string;
  dirty: boolean;
}

export type ManagerLogger = (level: "info" | "warn" | "error", message: string) => void;

/** JSON con claves ordenadas: dos configuraciones iguales dan la misma cadena. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Cambios que deben enviarse de inmediato (estado o trabajo distinto). */
const signature = (t: PrinterTelemetry) => `${t.state}|${t.job?.fileName ?? ""}|${t.job?.title ?? ""}|${t.errors?.[0]?.message ?? ""}`;

export class PrinterManager {
  private entries = new Map<string, Entry>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private flushing = false;
  private stopped = false;

  constructor(
    private sink: TelemetrySink,
    private log: ManagerLogger = () => {},
    private now: () => number = Date.now,
  ) {}

  /** Ajusta las conexiones a la lista dada: arranca nuevas, reinicia las cambiadas y para las quitadas. */
  async sync(machines: ManagedMachine[]): Promise<void> {
    if (this.stopped) return;
    const wanted = new Map(machines.filter((m) => m.connectionType !== "none").map((m) => [m.id, m]));
    for (const [id, entry] of this.entries) {
      const next = wanted.get(id);
      if (!next || `${next.connectionType}:${stable(next.config)}:${stable(next.meta ?? {})}` !== entry.key) {
        await this.remove(id);
      }
    }
    for (const machine of wanted.values()) {
      if (this.entries.has(machine.id)) continue;
      const entry: Entry = {
        key: `${machine.connectionType}:${stable(machine.config)}:${stable(machine.meta ?? {})}`,
        adapter: null,
        lastSentAt: 0,
        dirty: false,
      };
      this.entries.set(machine.id, entry);
      try {
        const factory = await loadAdapter(machine.connectionType);
        if (!factory || this.entries.get(machine.id) !== entry) continue;
        entry.adapter = factory({
          machineId: machine.id,
          config: machine.config,
          meta: machine.meta,
          onTelemetry: (telemetry) => {
            if (this.entries.get(machine.id) !== entry) return;
            entry.last = telemetry;
            entry.dirty = true;
          },
          log: (level, message) => this.log(level, `[${machine.meta?.name ?? machine.id.slice(0, 8)}] ${message}`),
        });
        entry.adapter.start();
      } catch (error) {
        this.log("error", `No se pudo iniciar el adaptador ${machine.connectionType}: ${String(error)}`);
      }
    }
    if (!this.timer && this.entries.size > 0) {
      this.timer = setInterval(() => void this.flush(), FLUSH_MS);
      this.timer.unref?.();
    }
  }

  private async remove(id: string) {
    const entry = this.entries.get(id);
    this.entries.delete(id);
    try {
      await entry?.adapter?.stop();
    } catch (error) {
      this.log("warn", `Error al parar un adaptador: ${String(error)}`);
    }
  }

  /** Envía lo pendiente respetando el ritmo por máquina. Público para tests. */
  async flush(): Promise<void> {
    if (this.flushing || this.stopped) return;
    this.flushing = true;
    try {
      const now = this.now();
      const batch: Array<{ entry: Entry; item: TelemetryItem; sig: string }> = [];
      for (const [machineId, entry] of this.entries) {
        if (!entry.last) continue;
        const sig = signature(entry.last);
        const changed = sig !== entry.lastSignature;
        const since = now - entry.lastSentAt;
        const due = changed || (entry.dirty && since >= MIN_INTERVAL_MS) || since >= HEARTBEAT_MS;
        if (!due) continue;
        batch.push({ entry, sig, item: { machineId, telemetry: entry.last, at: new Date(now).toISOString() } });
      }
      if (batch.length === 0) return;
      try {
        await this.sink.deliver(batch.map((b) => b.item));
        for (const b of batch) {
          b.entry.lastSentAt = now;
          b.entry.lastSignature = b.sig;
          b.entry.dirty = false;
        }
      } catch (error) {
        // Se conserva el último estado de cada máquina y se reintenta en el siguiente ciclo.
        this.log("warn", `No se pudo entregar la telemetría: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      this.flushing = false;
    }
  }

  get size() {
    return this.entries.size;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.all([...this.entries.keys()].map((id) => this.remove(id)));
  }
}
