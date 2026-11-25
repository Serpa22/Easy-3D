import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { digestHeader } from "@/server/printers/adapters/_http";
import { mapBambu, mergeBambu } from "@/server/printers/adapters/bambu";
import { createAdapter as elegoo, mapSdcp } from "@/server/printers/adapters/elegoo";
import { createAdapter as moonraker, mapMoonraker } from "@/server/printers/adapters/moonraker";
import { createAdapter as octoprint, mapOctoPrint } from "@/server/printers/adapters/octoprint";
import { createAdapter as prusalink, mapPrusaLink } from "@/server/printers/adapters/prusalink";
import type { PrinterTelemetry } from "@/lib/telemetry";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  // En orden inverso: primero se paran los adaptadores y después los servidores de prueba.
  for (const c of cleanups.splice(0).reverse()) await c();
});

/** Recoge la telemetría de un adaptador hasta que se cumple una condición. */
function collect(start: (onTelemetry: (t: PrinterTelemetry) => void) => { stop(): Promise<void> }, until: (t: PrinterTelemetry) => boolean, timeoutMs = 8000) {
  return new Promise<PrinterTelemetry>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sin telemetría esperada")), timeoutMs);
    const adapter = start((t) => {
      if (until(t)) {
        clearTimeout(timer);
        resolve(t);
      }
    });
    cleanups.push(() => adapter.stop());
  });
}

describe("Bambu Lab", () => {
  const now = Date.parse("2026-11-25T10:00:00Z");
  it("fusiona actualizaciones parciales y traduce una impresión en curso", () => {
    const print: Record<string, unknown> = {};
    mergeBambu(print, {
      gcode_state: "RUNNING", stg_cur: 0, mc_percent: 42, mc_remaining_time: 75, layer_num: 120, total_layer_num: 300,
      subtask_name: "set_teclas", gcode_file: "/data/Metadata/plate_1.gcode", nozzle_temper: 219.6, nozzle_target_temper: 220, bed_temper: 59.8, bed_target_temper: 60,
      chamber_temper: 5, spd_mag: 100, cooling_fan_speed: "15",
      ams: { tray_now: "1", ams: [{ id: "0", tray: [{ id: "0", tray_type: "PLA", tray_color: "111111FF", remain: 80, tag_uid: "A1B2" }, { id: "1", tray_type: "PETG", tray_color: "CFE3EAFF", tray_sub_brands: "PETG HF", remain: 55, tag_uid: "0000000000000000" }] }] },
    });
    // La serie P1 envía después solo lo que cambia (y bandejas parciales por id).
    mergeBambu(print, { mc_percent: 43, ams: { ams: [{ id: "0", tray: [{ id: "1", remain: 54 }] }] } });
    const t = mapBambu(print, { nowMs: now, startedAtMs: now - 3600_000 });
    expect(t.state).toBe("printing");
    expect(t.job).toMatchObject({ title: "set_teclas", fileName: "set_teclas.3mf", progress: 43, layer: 120, totalLayers: 300, remainingSec: 4500, elapsedSec: 3600 });
    expect(t.temps?.nozzle).toEqual({ current: 219.6, target: 220 });
    expect(t.temps?.chamber).toBeUndefined(); // 5 °C es un valor de relleno en P1/A1
    expect(t.fanPct).toBe(100);
    expect(t.filament).toHaveLength(2);
    expect(t.filament?.[0]).toMatchObject({ slot: "AMS 1 · 1", type: "PLA", color: "#111111", remainingPct: 80 });
    expect(t.filament?.[1]).toMatchObject({ slot: "AMS 1 · 2", name: "PETG HF", active: true });
    expect(t.filament?.[1].remainingPct).toBeUndefined(); // sin etiqueta RFID no es fiable
  });

  it("traduce todos los estados nativos", () => {
    const state = (p: Record<string, unknown>, ctx = {}) => mapBambu(p, { nowMs: now, ...ctx }).state;
    expect(state({ gcode_state: "IDLE" })).toBe("idle");
    expect(state({ gcode_state: "PREPARE", gcode_file_prepare_percent: "40" })).toBe("preparing");
    expect(state({ gcode_state: "SLICING" })).toBe("preparing");
    expect(state({ gcode_state: "RUNNING", stg_cur: 1, layer_num: 0 })).toBe("preparing"); // nivelando
    expect(state({ gcode_state: "RUNNING", stg_cur: 4, layer_num: 12 })).toBe("printing"); // cambio de filamento a media impresión
    expect(state({ gcode_state: "RUNNING", stg_cur: 255 })).toBe("printing");
    expect(state({ gcode_state: "PAUSE", stg_cur: 16 })).toBe("paused");
    expect(state({ gcode_state: "RUNNING", stg_cur: 6 })).toBe("paused"); // sin filamento
    expect(state({ gcode_state: "FINISH" })).toBe("finished");
    expect(state({ gcode_state: "FAILED", print_error: 117473286 })).toBe("error");
    expect(state({ gcode_state: "FAILED", print_error: 0x0300400c })).toBe("idle"); // cancelada por el usuario
    expect(state({ gcode_state: "FAILED" }, { cancelled: true })).toBe("idle");
    expect(state({})).toBe("offline");
    expect(mapBambu({ gcode_state: "IDLE", mc_percent: 100, subtask_name: "viejo" }, { nowMs: now }).job).toBeUndefined();
  });

  it("lee el formato nuevo empaquetado y los avisos HMS", () => {
    const t = mapBambu(
      {
        gcode_state: "RUNNING", stg_cur: 0, layer_num: 5,
        device: { extruder: { state: 0x10, info: [{ id: 0, temp: (220 << 16) | 215 }, { id: 1, temp: (250 << 16) | 248, snow: (0 << 8) | 2 }] }, bed: { info: { temp: (65 << 16) | 64 } }, ctc: { info: { temp: (45 << 16) | 38 } } },
        hms: [{ attr: 0x03000100, code: 0x00010007 }, { attr: 0x0c000300, code: 0x0003000b }, { attr: 0x07000000, code: 0x00040001 }],
        fan_gear: 128,
      },
      { nowMs: now },
    );
    expect(t.temps).toEqual({ nozzle: { current: 248, target: 250 }, bed: { current: 64, target: 65 }, chamber: { current: 38, target: 45 } });
    expect(t.fanPct).toBe(50);
    expect(t.errors?.map((e) => e.code)).toEqual(["HMS_0300_0100_0001_0007"]); // se ignoran el aviso informativo y el de estado
  });
});

describe("Moonraker", () => {
  it("traduce el estado de Klipper", () => {
    const base = { webhooks: { state: "ready" }, extruder: { temperature: 214.8, target: 215 }, heater_bed: { temperature: 60, target: 60 }, fan: { speed: 0.8 }, gcode_move: { speed_factor: 1.2 }, toolhead: { extruder: "extruder", homed_axes: "xyz" } };
    const printing = mapMoonraker({ ...base, print_stats: { state: "printing", filename: "caja/teclas.gcode", print_duration: 1800, total_duration: 2000, filament_used: 5000, info: { current_layer: 40, total_layer: 200 } }, display_status: { progress: 0.25 } }, { estimated_time: 7200, filament_total: 20000, filament_weight_total: 60 });
    expect(printing.state).toBe("printing");
    expect(printing.job).toMatchObject({ fileName: "caja/teclas.gcode", title: "teclas", progress: 25, layer: 40, totalLayers: 200, elapsedSec: 2000, filamentUsedMm: 5000, filamentUsedG: 15, remainingSec: 5400 });
    expect(printing.speedPct).toBe(120);
    expect(printing.fanPct).toBe(80);

    const heating = mapMoonraker({ ...base, heater_bed: { temperature: 30, target: 60 }, print_stats: { state: "printing", filename: "a.gcode", print_duration: 0 } }, undefined);
    expect(heating).toMatchObject({ state: "preparing", stateDetail: "Calentando la cama" });
    expect(mapMoonraker({ ...base, print_stats: { state: "paused", filename: "a.gcode" } }, undefined).state).toBe("paused");
    expect(mapMoonraker({ ...base, print_stats: { state: "complete", filename: "a.gcode" } }, undefined)).toMatchObject({ state: "finished", job: { progress: 100 } });
    expect(mapMoonraker({ ...base, print_stats: { state: "cancelled", filename: "a.gcode" } }, undefined).state).toBe("idle");
    expect(mapMoonraker({ ...base, print_stats: { state: "standby", filename: "" } }, undefined)).toMatchObject({ state: "idle" });
    expect(mapMoonraker({ ...base, print_stats: { state: "error", filename: "a.gcode", message: "Move out of range" } }, undefined)).toMatchObject({ state: "error", errors: [{ message: "Move out of range" }] });
    // Un apagado de emergencia manda sobre lo que diga print_stats.
    expect(mapMoonraker({ webhooks: { state: "shutdown", state_message: "MCU shutdown\nmás" }, print_stats: { state: "printing", filename: "a.gcode" } }, undefined)).toMatchObject({ state: "error", stateDetail: "MCU shutdown" });
    expect(mapMoonraker({ webhooks: { state: "startup" } }, undefined).state).toBe("offline");
  });

  it("habla JSON-RPC con un servidor real: se suscribe y fusiona los cambios", async () => {
    const wss = new WebSocketServer({ port: 0 });
    cleanups.push(() => new Promise<void>((r) => {
      for (const client of wss.clients) client.terminate();
      wss.close(() => r());
    }));
    const status = { webhooks: { state: "ready" }, print_stats: { state: "printing", filename: "teclas.gcode", print_duration: 100, total_duration: 120, filament_used: 0 }, display_status: { progress: 0.1 }, extruder: { temperature: 210, target: 215 }, heater_bed: { temperature: 60, target: 60 }, toolhead: { extruder: "extruder" } };
    wss.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        const reply = (result: unknown) => socket.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
        if (msg.method === "server.info") reply({ klippy_state: "ready", klippy_connected: true });
        else if (msg.method === "printer.info") reply({ software_version: "v0.12.0" });
        else if (msg.method === "printer.objects.list") reply({ objects: Object.keys(status).concat("fan") });
        else if (msg.method === "printer.objects.subscribe") {
          reply({ status, eventtime: 1 });
          // Moonraker envía después solo lo que cambia.
          setTimeout(() => socket.send(JSON.stringify({ jsonrpc: "2.0", method: "notify_status_update", params: [{ display_status: { progress: 0.5 }, print_stats: { print_duration: 600 } }, 2] })), 50);
        } else if (msg.method === "server.files.metadata") reply({ estimated_time: 1200 });
        else if (msg.method === "server.webcams.list") reply({ webcams: [] });
        else reply({});
      });
    });
    const port = (wss.address() as AddressInfo).port;
    const t = await collect((onTelemetry) => {
      const a = moonraker({ machineId: "m", config: { host: "127.0.0.1", port }, onTelemetry, log: () => {} });
      a.start();
      return a;
    }, (x) => x.state === "printing" && x.job?.progress === 50);
    expect(t.job).toMatchObject({ fileName: "teclas.gcode", progress: 50 });
    expect(t.temps?.nozzle).toEqual({ current: 210, target: 215 }); // se conserva lo que no cambió
    expect(t.firmware).toBe("Klipper v0.12.0");
  });
});

function serve(handler: http.RequestListener): Promise<string> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

describe("OctoPrint", () => {
  it("traduce estados y trabajo", () => {
    const printer = { temperature: { tool0: { actual: 210, target: 215 }, bed: { actual: 60, target: 60 } }, state: { text: "Printing", flags: { operational: true, printing: true } } };
    const job = { job: { file: { name: "teclas.gcode", display: "teclas.gcode" }, filament: { tool0: { length: 10000 } } }, progress: { completion: 40, printTime: 1200, printTimeLeft: 1800 }, state: "Printing" };
    expect(mapOctoPrint(job, printer)).toMatchObject({ state: "printing", job: { fileName: "teclas.gcode", title: "teclas", progress: 40, elapsedSec: 1200, remainingSec: 1800, filamentUsedMm: 4000 }, temps: { nozzle: { current: 210, target: 215 } } });
    expect(mapOctoPrint({ state: "Paused", job: { file: { name: "a.gcode" } }, progress: {} }, { state: { flags: { paused: true } } }).state).toBe("paused");
    expect(mapOctoPrint({ state: "Operational", job: { file: { name: null } }, progress: { completion: null } }, { state: { flags: { operational: true, ready: true } } })).toEqual({ state: "idle" });
    expect(mapOctoPrint({ state: "Operational", job: { file: { name: "a.gcode" } }, progress: { completion: 100 } }, { state: { flags: { operational: true } } }).state).toBe("finished");
    expect(mapOctoPrint({ state: "Offline", job: {}, progress: {} }, null)).toMatchObject({ state: "offline" });
    expect(mapOctoPrint({ state: "Error: Printer halted", job: {}, progress: {} }, null)).toMatchObject({ state: "error", errors: [{ message: "Error: Printer halted" }] });
  });

  it("consulta la API con la clave y trata el 409 como impresora desconectada", async () => {
    let key: string | undefined;
    const base = await serve((req, res) => {
      key = req.headers["x-api-key"] as string;
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/printer") {
        res.statusCode = 409;
        return res.end(JSON.stringify({ error: "Printer is not operational" }));
      }
      if (req.url === "/api/job") return res.end(JSON.stringify({ state: "Offline", job: { file: { name: null } }, progress: {} }));
      res.end(JSON.stringify({ server: "1.10.0" }));
    });
    const t = await collect((onTelemetry) => {
      const a = octoprint({ machineId: "m", config: { baseUrl: base, apiKey: "CLAVE" }, onTelemetry, log: () => {} });
      a.start();
      return a;
    }, (x) => x.stateDetail !== undefined);
    expect(t).toMatchObject({ state: "offline", stateDetail: "La impresora no está conectada a OctoPrint" });
    expect(key).toBe("CLAVE");
  });
});

describe("PrusaLink", () => {
  it("traduce los estados de la API v1", () => {
    const status = (state: string, job?: object) => ({ printer: { state, temp_nozzle: 215, target_nozzle: 215, temp_bed: 60, target_bed: 60, speed: 100 }, ...(job ? { job } : {}) });
    const job = { id: 7, progress: 33, time_printing: 600, time_remaining: 1200, file: { name: "TECLAS~1.BGC", display_name: "teclas.bgcode" } };
    expect(mapPrusaLink(status("PRINTING", { id: 7, progress: 33 }), job)).toMatchObject({ state: "printing", job: { fileName: "TECLAS~1.BGC", title: "teclas", progress: 33, elapsedSec: 600, remainingSec: 1200 }, speedPct: 100 });
    expect(mapPrusaLink(status("IDLE"), null)).toMatchObject({ state: "idle" });
    expect(mapPrusaLink(status("BUSY"), null)).toMatchObject({ state: "idle", stateDetail: "Ocupada" });
    expect(mapPrusaLink(status("PAUSED", { id: 7 }), job).state).toBe("paused");
    expect(mapPrusaLink(status("FINISHED", { id: 7 }), job).state).toBe("finished");
    expect(mapPrusaLink(status("STOPPED"), null)).toMatchObject({ state: "idle", stateDetail: "Cancelada" });
    expect(mapPrusaLink(status("ATTENTION", { id: 7 }), job)).toMatchObject({ state: "paused", stateDetail: "Requiere tu atención" });
    expect(mapPrusaLink(status("ERROR"), null).state).toBe("error");
  });

  it("se autentica con HTTP Digest cuando no hay clave API", async () => {
    const seen: string[] = [];
    const base = await serve((req, res) => {
      const auth = req.headers.authorization;
      if (!auth) {
        res.statusCode = 401;
        res.setHeader("WWW-Authenticate", 'Digest realm="Printer API", nonce="abc123", qop="auth"');
        return res.end();
      }
      seen.push(auth);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(req.url === "/api/v1/status" ? { printer: { state: "IDLE", temp_nozzle: 25, temp_bed: 24 } } : {}));
    });
    const t = await collect((onTelemetry) => {
      const a = prusalink({ machineId: "m", config: { host: base, username: "maker", password: "secreta" }, onTelemetry, log: () => {} });
      a.start();
      return a;
    }, (x) => x.state === "idle");
    expect(t.temps?.nozzle?.current).toBe(25);
    expect(seen[0]).toMatch(/^Digest username="maker", realm="Printer API", nonce="abc123", uri="\/api\/(version|v1\/status)", response="[0-9a-f]{32}", qop=auth/);
    expect(seen.join()).not.toContain("secreta");
    // Vector de la RFC 2617 (MD5, qop=auth) con cnonce fijo no reproducible aquí: se comprueba la forma.
    expect(digestHeader('Basic realm="x"', "GET", "/", "u", "p")).toBeNull();
  });
});

describe("Elegoo SDCP (experimental)", () => {
  it("traduce el estado de una impresora de resina", () => {
    const printing = mapSdcp({ CurrentStatus: [1], PrintInfo: { Status: 3, CurrentLayer: 250, TotalLayer: 1000, CurrentTicks: 3_600_000, TotalTicks: 14_400_000, Filename: "caballeros.ctb", ErrorNumber: 0 }, TempOfBox: 28.5, TempOfUVLED: 40 });
    expect(printing).toMatchObject({ state: "printing", job: { fileName: "caballeros.ctb", title: "caballeros", progress: 25, layer: 250, totalLayers: 1000, elapsedSec: 3600, remainingSec: 10800 }, temps: { chamber: { current: 28.5 } } });
    expect(printing.temps?.nozzle).toBeUndefined();
    expect(mapSdcp({ CurrentStatus: [0], PrintInfo: { Status: 0 } })).toEqual({ state: "idle" });
    expect(mapSdcp({ CurrentStatus: [1], PrintInfo: { Status: 6, Filename: "a.ctb" } }).state).toBe("paused");
    expect(mapSdcp({ CurrentStatus: [0], PrintInfo: { Status: 9, Filename: "a.ctb", CurrentLayer: 10, TotalLayer: 10 } })).toMatchObject({ state: "finished", job: { progress: 100 } });
    expect(mapSdcp({ CurrentStatus: [1], PrintInfo: { Status: 1, Filename: "a.ctb" } }).state).toBe("preparing");
  });
});

describe("seguridad de las conexiones", () => {
  it("no sigue redirecciones: la clave no llega a otro servicio", async () => {
    const internal: Array<{ url?: string; key?: string | string[] }> = [];
    const secretService = await serve((req, res) => {
      internal.push({ url: req.url, key: req.headers["x-api-key"] });
      res.end("TOPSECRET-contenido interno");
    });
    const attacker = await serve((_req, res) => {
      res.statusCode = 302;
      res.setHeader("Location", `${secretService}/interno`);
      res.end();
    });
    const logs: string[] = [];
    const seen: PrinterTelemetry[] = [];
    const adapter = octoprint({ machineId: "m", config: { baseUrl: attacker, apiKey: "clave-guardada" }, onTelemetry: (t) => seen.push(t), log: (_l, m) => logs.push(m) });
    cleanups.push(() => adapter.stop());
    adapter.start();
    await new Promise((r) => setTimeout(r, 600));
    expect(internal).toEqual([]);
    expect(seen.every((t) => t.state === "offline")).toBe(true);
    // El registro no contiene nada de la respuesta remota.
    expect(logs.join(" ")).not.toContain("TOPSECRET");
  });

  it("una dirección mal escrita deja la máquina sin conexión, sin lanzar errores ni reintentar", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      for (const [factory, config] of [
        [moonraker, { host: "192.168.1.60:7125:7125" }],
        [moonraker, { host: "mi impresora" }],
        [moonraker, { host: "169.254.169.254" }],
        [elegoo, { host: "192.168.1. 90" }],
        [octoprint, { baseUrl: "http://exa mple", apiKey: "k" }],
        [prusalink, { host: "http://u:p@192.168.1.80", apiKey: "k" }],
      ] as const) {
        const seen: PrinterTelemetry[] = [];
        const adapter = factory({ machineId: "m", config, onTelemetry: (t) => seen.push(t), log: () => {} });
        expect(() => adapter.start()).not.toThrow();
        await new Promise((r) => setTimeout(r, 30));
        await adapter.stop();
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({ state: "offline", errors: [{ message: expect.stringMatching(/no es válida/) }] });
      }
      await new Promise((r) => setTimeout(r, 50));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });
});
