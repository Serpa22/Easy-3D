import { describe, expect, it } from "vitest";
import { getDb } from "@/server/db";
import { machineEvents, machines, printJobs } from "@/server/db/schema";
import { sanitizeTelemetry } from "@/server/printers/adapters/_shared";
import { seedFrom, simulateTelemetry } from "@/server/printers/adapters/simulator";
import { applyTelemetry } from "@/server/printers/ingest";
import { PrinterManager } from "@/server/printers/manager";
import type { TelemetryItem } from "@/server/printers/types";
import { maskConnectionConfig, mergeConnectionConfig } from "@/lib/connections";
import { freshDb, makeCompany } from "../../helpers/db";

describe("simulador", () => {
  const seed = seedFrom("máquina-1");
  it("es determinista y produce estados y cifras válidos", () => {
    const start = Date.parse("2026-11-25T00:00:00Z");
    const states = new Set<string>();
    let lastProgress = -1;
    let lastFile = "";
    for (let s = 0; s < 3600; s += 2) {
      const now = start + s * 1000;
      const a = simulateTelemetry(seed, 60, now);
      expect(a).toEqual(simulateTelemetry(seed, 60, now));
      expect(sanitizeTelemetry(a).state).toBe(a.state);
      states.add(a.state);
      if (a.temps?.nozzle) expect(a.temps.nozzle.current).toBeGreaterThan(15);
      if (a.temps?.nozzle) expect(a.temps.nozzle.current).toBeLessThan(260);
      if (a.state === "printing" && a.job) {
        expect(a.job.progress).toBeGreaterThanOrEqual(0);
        expect(a.job.progress).toBeLessThanOrEqual(100);
        if (a.job.fileName === lastFile) expect(a.job.progress!).toBeGreaterThanOrEqual(lastProgress);
        lastProgress = a.job.progress!;
        lastFile = a.job.fileName!;
      } else if (a.state !== "paused") {
        // Fuera de la impresión empieza otro trabajo (aunque repita archivo).
        lastFile = "";
      }
    }
    // En 60 h simuladas pasa por reposo, preparación, impresión y fin.
    for (const s of ["idle", "preparing", "printing", "finished"]) expect(states.has(s)).toBe(true);
  });
  it("el perfil de resina no inventa boquilla ni filamento", () => {
    for (let s = 0; s < 2000; s += 50) {
      const t = simulateTelemetry(seed, 60, Date.parse("2026-11-25T00:00:00Z") + s * 1000, "resin");
      expect(t.temps?.nozzle).toBeUndefined();
      expect(t.filament).toBeUndefined();
    }
  });
});

describe("gestor de conexiones", () => {
  it("dosifica envíos, manda latidos y reintenta si el destino falla", async () => {
    let now = 1_000_000;
    const delivered: TelemetryItem[][] = [];
    let fail = false;
    const manager = new PrinterManager(
      {
        deliver: async (items) => {
          if (fail) throw new Error("sin red");
          delivered.push(items);
        },
      },
      () => {},
      () => now,
    );
    await manager.sync([{ id: "m1", connectionType: "simulator", config: { speed: 1 } }]);
    await new Promise((r) => setTimeout(r, 50)); // el simulador emite al arrancar
    await manager.flush();
    expect(delivered).toHaveLength(1); // primer estado: inmediato

    await manager.flush();
    expect(delivered).toHaveLength(1); // sin cambios y antes de 2 s: nada

    now += 16_000;
    await manager.flush();
    expect(delivered).toHaveLength(2); // latido

    fail = true;
    now += 16_000;
    await manager.flush();
    fail = false;
    await manager.flush();
    expect(delivered).toHaveLength(3); // reintento tras el fallo

    // Misma configuración con las claves en otro orden: no reinicia.
    const before = manager.size;
    await manager.sync([{ id: "m1", connectionType: "simulator", config: { speed: 1 } }]);
    expect(manager.size).toBe(before);
    await manager.sync([]);
    expect(manager.size).toBe(0);
    await manager.stop();
  });
});

describe("de extremo a extremo con el simulador", () => {
  it("unas horas simuladas dejan impresiones cerradas con energía y eventos", async () => {
    await freshDb();
    const db = await getDb();
    const company = await makeCompany("Teclas");
    const [machine] = await db.insert(machines).values({ companyId: company.id, name: "Sim", connectionType: "simulator", powerPrintW: 120 }).returning();
    const seed = seedFrom(machine.id);
    const start = Date.parse("2026-11-20T00:00:00Z");
    // 30 h simuladas, un paso por minuto simulado.
    for (let minute = 0; minute < 30 * 60; minute++) {
      const at = start + minute * 60_000;
      await applyTelemetry(db, { machineId: machine.id, telemetry: simulateTelemetry(seed, 1, at), at: new Date(at).toISOString() });
    }
    const jobs = await db.select().from(printJobs);
    const closed = jobs.filter((j) => j.endedAt);
    expect(closed.length).toBeGreaterThanOrEqual(3);
    expect(closed.every((j) => j.durationSec > 0 && j.energyKwh > 0)).toBe(true);
    expect(jobs.filter((j) => !j.endedAt).length).toBeLessThanOrEqual(1);
    const types = (await db.select().from(machineEvents)).map((e) => e.type);
    expect(types.filter((t) => t === "print_started").length).toBe(jobs.length);
  }, 120_000);
});

describe("datos de conexión", () => {
  it("enmascara secretos y los conserva si el formulario los deja vacíos", () => {
    const stored = { host: "192.168.1.50", serial: "01P00A1", accessCode: "12345678" };
    const masked = maskConnectionConfig("bambu", stored);
    expect(masked).toEqual({ host: "192.168.1.50", serial: "01P00A1", __has_accessCode: true });
    expect(JSON.stringify(masked)).not.toContain("12345678");

    const kept = mergeConnectionConfig("bambu", { host: "192.168.1.51", serial: "01P00A1", accessCode: "" }, { type: "bambu", config: stored });
    expect(kept).toEqual({ config: { host: "192.168.1.51", serial: "01P00A1", accessCode: "12345678" }, errors: {} });

    // Al cambiar de tipo no se arrastran secretos del anterior.
    const changed = mergeConnectionConfig("octoprint", { baseUrl: "http://192.168.1.70", apiKey: "" }, { type: "bambu", config: stored });
    expect(changed.errors).toEqual({ apiKey: "Campo obligatorio" });
    expect(JSON.stringify(changed.config)).not.toContain("12345678");

    expect(mergeConnectionConfig("moonraker", { host: "voron.local" }, null).config).toEqual({ host: "voron.local", port: 7125 });
  });
});
