import { describe, expect, it } from "vitest";
import { getDb } from "@/server/db";
import { machineEvents, machines, printJobs } from "@/server/db/schema";
import { sanitizeTelemetry } from "@/server/printers/adapters/_shared";
import { seedFrom, simulateTelemetry } from "@/server/printers/adapters/simulator";
import { applyTelemetry } from "@/server/printers/ingest";
import { PrinterManager } from "@/server/printers/manager";
import type { TelemetryItem } from "@/server/printers/types";
import { maskConnectionConfig, mergeConnectionConfig } from "@/lib/connections";
import { isBlockedHost, parseTarget } from "@/lib/net-target";
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
    const company = await makeCompany("Prokeys");
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
  const stored = { host: "192.168.1.50", serial: "01P00A1", accessCode: "12345678" };
  const previous = { type: "bambu" as const, config: stored };

  it("enmascara secretos y los conserva si el formulario los deja vacíos", () => {
    const masked = maskConnectionConfig("bambu", stored);
    expect(masked).toEqual({ host: "192.168.1.50", serial: "01P00A1", __has_accessCode: true });
    expect(JSON.stringify(masked)).not.toContain("12345678");

    // Mismo destino + secreto vacío → se conserva el guardado.
    const kept = mergeConnectionConfig("bambu", { host: "192.168.1.50", serial: "01P00A1", accessCode: "" }, previous);
    expect(kept).toEqual({ config: stored, errors: {} });

    // Al cambiar de tipo no se arrastran secretos del anterior.
    const changed = mergeConnectionConfig("octoprint", { baseUrl: "http://192.168.1.70", apiKey: "" }, previous);
    expect(changed.errors).toEqual({ apiKey: "Campo obligatorio" });
    expect(JSON.stringify(changed.config)).not.toContain("12345678");

    expect(mergeConnectionConfig("moonraker", { host: "voron.local" }, null).config).toEqual({ host: "voron.local", port: 7125 });
  });

  it("no reutiliza un secreto guardado si cambia el destino (evita desviar la clave a otra dirección)", () => {
    for (const submitted of [
      { host: "192.168.1.51", serial: "01P00A1", accessCode: "" },
      { host: "192.168.1.50", serial: "OTRO", accessCode: "" },
    ]) {
      const result = mergeConnectionConfig("bambu", submitted, previous);
      expect(result.errors.accessCode).toMatch(/vuelve a escribir/);
      expect(JSON.stringify(result)).not.toContain("12345678");
    }
    // Escribiéndolo de nuevo sí se puede cambiar la dirección.
    const retyped = mergeConnectionConfig("bambu", { host: "192.168.1.51", serial: "01P00A1", accessCode: "87654321" }, previous);
    expect(retyped).toEqual({ config: { host: "192.168.1.51", serial: "01P00A1", accessCode: "87654321" }, errors: {} });

    // Moonraker: cambiar solo el puerto también cuenta como otro destino.
    const moon = { type: "moonraker" as const, config: { host: "voron.local", port: 7125, apiKey: "clave-secreta" } };
    expect(mergeConnectionConfig("moonraker", { host: "voron.local", port: "7125", apiKey: "" }, moon).config.apiKey).toBe("clave-secreta");
    const otherPort = mergeConnectionConfig("moonraker", { host: "voron.local", port: "9999", apiKey: "" }, moon);
    expect(otherPort.errors.apiKey).toBeTruthy();
    expect(JSON.stringify(otherPort)).not.toContain("clave-secreta");
    // Un secreto opcional guardado se puede quitar de forma explícita, también al cambiar de dirección.
    const cleared = mergeConnectionConfig("moonraker", { host: "otra.local", port: "7125", apiKey: "", apiKey__clear: "on" }, moon);
    expect(cleared).toEqual({ config: { host: "otra.local", port: 7125 }, errors: {} });
  });

  it("rechaza direcciones mal escritas o no permitidas", () => {
    const bad = (type: Parameters<typeof mergeConnectionConfig>[0], host: string, key = "host") =>
      mergeConnectionConfig(type, { [key]: host, serial: "S", accessCode: "c", apiKey: "k" }, null).errors[key];
    expect(bad("moonraker", "192.168.1.60:7125:7125")).toBeTruthy();
    expect(bad("moonraker", "192.168.1. 60")).toBeTruthy();
    expect(bad("moonraker", "mi impresora")).toBeTruthy();
    expect(bad("moonraker", "usuario:clave@192.168.1.60")).toBeTruthy();
    expect(bad("moonraker", "192.168.1.60/ruta")).toBeTruthy();
    expect(bad("bambu", "192.168.1.50:8883")).toBeTruthy();
    expect(bad("bambu", "http://192.168.1.50")).toBeTruthy();
    expect(bad("elegoo", "169.254.169.254")).toBeTruthy();
    expect(bad("octoprint", "http://169.254.169.254/latest/meta-data", "baseUrl")).toBeTruthy();
    expect(bad("octoprint", "http://metadata.google.internal", "baseUrl")).toBeTruthy();
    expect(bad("octoprint", "ftp://192.168.1.70", "baseUrl")).toBeTruthy();
    expect(bad("octoprint", "http://192.168.1.70/?x=1", "baseUrl")).toBeTruthy();
    expect(mergeConnectionConfig("moonraker", { host: "voron.local", port: "70000" }, null).errors.port).toBeTruthy();

    expect(bad("moonraker", "192.168.1.60")).toBeUndefined();
    expect(bad("moonraker", "voron.local:7125")).toBeUndefined();
    expect(bad("moonraker", "https://klipper.taller.lan")).toBeUndefined();
    expect(bad("bambu", "192.168.1.50")).toBeUndefined();
    expect(bad("octoprint", "http://octopi.local/octoprint", "baseUrl")).toBeUndefined();
    expect(bad("octoprint", "192.168.1.70:5000", "baseUrl")).toBeUndefined();
    expect(bad("prusalink", "192.168.1.80")).toBeUndefined();
  });
});

describe("direcciones de impresora", () => {
  it("normaliza y valida", () => {
    expect(parseTarget("192.168.1.60")).toEqual({ host: "192.168.1.60", secure: false, path: "" });
    expect(parseTarget(" Voron.Local:7125 ", { port: true })).toEqual({ host: "voron.local", port: 7125, secure: false, path: "" });
    expect(parseTarget("https://octopi.local:80/octoprint/", { scheme: true, port: true, path: true })).toEqual({ host: "octopi.local", port: 80, secure: true, path: "/octoprint" });
    expect(parseTarget("[fd12::1]:7125", { port: true })).toEqual({ host: "[fd12::1]", port: 7125, secure: false, path: "" });
    // Formas raras de escribir una IP se normalizan antes de comprobar la lista de bloqueo.
    expect(parseTarget("0xa9.0xfe.0xa9.0xfe")?.host).toBe("169.254.169.254");
    expect(parseTarget("2852039166")?.host).toBe("169.254.169.254");
    expect(isBlockedHost("169.254.169.254")).toBe(true);
    expect(isBlockedHost("[fe80::1]")).toBe(true);
    expect(isBlockedHost("[::ffff:a9fe:a9fe]")).toBe(true);
    expect(isBlockedHost("192.168.1.60")).toBe(false);
    expect(isBlockedHost("127.0.0.1")).toBe(false);
    for (const bad of ["", "a b", "host:99999", "host:1:2", "http://x", "x/y", "x?y", "x#y", "u@h", "-bad-", "ho_st", "a\\b"]) expect(parseTarget(bad, { port: true })).toBeNull();
  });
});
