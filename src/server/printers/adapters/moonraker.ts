/**
 * Klipper + Moonraker: WebSocket JSON-RPC en `ws://<host>:7125/websocket`.
 * Se suscribe a los objetos de estado de Klipper; Moonraker envía solo los
 * cambios, que se fusionan en una copia local.
 */
import WebSocket from "ws";
import type { PrinterState } from "../../../lib/domain";
import type { PrinterTelemetry } from "../../../lib/telemetry";
import type { AdapterFactory } from "../types";
import { arr, backoffMs, deepMerge, num, obj, str, titleFromFile } from "./_shared";

export interface MoonrakerMeta {
  estimated_time?: number;
  filament_total?: number;
  filament_weight_total?: number;
  layer_count?: number;
  thumbnailUrl?: string;
}

const firstLine = (text: unknown) => str(String(text ?? "").split("\n")[0], 300);

/** Traduce el estado fusionado de Klipper al modelo común. Función pura. */
export function mapMoonraker(S: Record<string, unknown>, meta: MoonrakerMeta | undefined, extra: { klippyState?: string; chamberKey?: string; fanKey?: string; firmware?: string; cameraUrl?: string } = {}): PrinterTelemetry {
  const stats = obj(S.print_stats);
  const webhooks = obj(S.webhooks);
  const klippy = str(webhooks.state) ?? extra.klippyState ?? "ready";
  const native = str(stats.state) ?? "standby";
  const display = obj(S.display_status);
  const printDuration = num(stats.print_duration) ?? 0;
  const message = str(display.message, 120);
  const toolhead = obj(S.toolhead);
  const extruder = obj(S[str(toolhead.extruder) ?? "extruder"]);
  const bed = obj(S.heater_bed);
  const errors: NonNullable<PrinterTelemetry["errors"]> = [];

  let state: PrinterState;
  let stateDetail: string | undefined;
  if (klippy === "disconnected" || klippy === "startup") {
    state = "offline";
    stateDetail = klippy === "startup" ? (firstLine(webhooks.state_message) ?? "Klipper arrancando") : "Klipper desconectado";
  } else if (klippy === "error" || klippy === "shutdown") {
    state = "error";
    stateDetail = firstLine(webhooks.state_message);
    errors.push({ message: str(webhooks.state_message, 300) ?? (klippy === "shutdown" ? "Klipper se ha detenido (parada de emergencia o fallo de firmware)." : "Error de Klipper.") });
  } else if (native === "error") {
    state = "error";
    stateDetail = str(stats.message, 120);
    errors.push({ message: str(stats.message, 300) ?? "La impresión se detuvo por un error." });
  } else if (native === "paused") {
    state = "paused";
    stateDetail = message;
  } else if (native === "printing") {
    if (printDuration <= 0.001) {
      state = "preparing";
      const bedTemp = num(bed.temperature) ?? 0;
      const bedTarget = num(bed.target) ?? 0;
      const nozzleTemp = num(extruder.temperature) ?? 0;
      const nozzleTarget = num(extruder.target) ?? 0;
      const homed = str(toolhead.homed_axes) ?? "";
      stateDetail =
        message ??
        (bedTarget > 0 && bedTemp < bedTarget - 2
          ? "Calentando la cama"
          : nozzleTarget > 0 && nozzleTemp < nozzleTarget - 2
            ? "Calentando la boquilla"
            : !["x", "y", "z"].every((a) => homed.includes(a))
              ? "Buscando el origen"
              : "Preparando");
    } else {
      state = "printing";
      stateDetail = message;
    }
  } else if (native === "complete") state = "finished";
  else if (native === "cancelled") {
    state = "idle";
    stateDetail = "Cancelada";
  } else {
    state = "idle";
    if (str(obj(S.idle_timeout).state) === "Printing") stateDetail = "Ocupada";
  }

  const out: PrinterTelemetry = { state, ...(stateDetail ? { stateDetail } : {}) };
  const fileName = str(stats.filename);
  if (fileName && native !== "standby") {
    const sd = obj(S.virtual_sdcard);
    const raw = num(display.progress) ?? num(sd.progress);
    const p = native === "complete" ? 1 : Math.min(1, Math.max(0, raw ?? 0));
    const info = obj(stats.info);
    const layer = num(info.current_layer) ?? num(sd.layer) ?? num(sd.current_layer);
    const totalLayers = num(info.total_layer) ?? num(sd.layer_count) ?? num(sd.total_layer) ?? meta?.layer_count;
    const used = num(stats.filament_used);
    const est = meta?.estimated_time ?? 0;
    let remaining: number | undefined;
    if (state === "printing" || state === "paused" || state === "preparing") {
      if (est > 0) {
        if (printDuration <= 0) remaining = est;
        else {
          const slicer = Math.max(0, est - printDuration);
          const byFile = p > 0.02 ? printDuration / p - printDuration : slicer;
          remaining = (slicer + byFile) / 2;
        }
      } else if (p > 0.02 && printDuration > 0) remaining = printDuration / p - printDuration;
    }
    out.job = {
      fileName,
      title: titleFromFile(fileName),
      progress: Math.round(p * 1000) / 10,
      ...(layer !== undefined && layer !== null ? { layer } : {}),
      ...(totalLayers ? { totalLayers } : {}),
      ...(num(stats.total_duration) !== undefined ? { elapsedSec: Math.round(num(stats.total_duration)!) } : {}),
      ...(remaining !== undefined ? { remainingSec: Math.round(remaining) } : {}),
      ...(used !== undefined ? { filamentUsedMm: Math.round(used) } : {}),
      ...(used !== undefined && meta?.filament_total && meta.filament_weight_total ? { filamentUsedG: Math.round(used * (meta.filament_weight_total / meta.filament_total) * 10) / 10 } : {}),
      ...(meta?.thumbnailUrl ? { thumbnailUrl: meta.thumbnailUrl } : {}),
    };
  }

  const temps: NonNullable<PrinterTelemetry["temps"]> = {};
  if (num(extruder.temperature) !== undefined) temps.nozzle = { current: num(extruder.temperature)!, target: num(extruder.target) ?? 0 };
  if (num(bed.temperature) !== undefined) temps.bed = { current: num(bed.temperature)!, target: num(bed.target) ?? 0 };
  const chamber = extra.chamberKey ? obj(S[extra.chamberKey]) : {};
  if (num(chamber.temperature) !== undefined) temps.chamber = { current: num(chamber.temperature)!, ...(num(chamber.target) !== undefined ? { target: num(chamber.target) } : {}) };
  if (Object.keys(temps).length > 0) out.temps = temps;

  const speed = num(obj(S.gcode_move).speed_factor);
  if (speed !== undefined) out.speedPct = Math.round(speed * 100);
  const fan = num(obj(S[extra.fanKey ?? "fan"]).speed);
  if (fan !== undefined) out.fanPct = Math.round(fan * 100);
  if (errors.length > 0) out.errors = errors;
  if (extra.firmware) out.firmware = extra.firmware;
  if (extra.cameraUrl) out.cameraUrl = extra.cameraUrl;
  return out;
}

export const createAdapter: AdapterFactory = (ctx) => {
  const rawHost = (str(ctx.config.host) ?? "").replace(/^(https?|wss?):\/\//i, "").replace(/\/+$/, "");
  const secure = /^(https|wss):\/\//i.test(str(ctx.config.host) ?? "");
  const hasPort = /:\d+$/.test(rawHost);
  const authority = hasPort ? rawHost : `${rawHost}:${num(ctx.config.port) ?? 7125}`;
  const httpBase = `${secure ? "https" : "http"}://${authority}`;
  const apiKey = str(ctx.config.apiKey);

  let ws: WebSocket | undefined;
  let stopped = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  let nextId = 1;
  const pending = new Map<number, (result: unknown, error?: unknown) => void>();
  let S: Record<string, unknown> = {};
  let klippyState: string | undefined;
  let chamberKey: string | undefined;
  let fanKey: string | undefined;
  let firmware: string | undefined;
  let cameraUrl: string | undefined;
  let meta: MoonrakerMeta | undefined;
  let metaFor: string | undefined;

  const offline = (message?: string) => ctx.onTelemetry({ state: "offline", ...(message ? { errors: [{ message }] } : {}) });
  const emit = () => ctx.onTelemetry(mapMoonraker(S, meta, { klippyState, chamberKey, fanKey, firmware, cameraUrl }));

  const call = (method: string, params?: Record<string, unknown>) =>
    new Promise<unknown>((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error("sin conexión"));
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`sin respuesta a ${method}`));
      }, 10_000);
      pending.set(id, (result, error) => {
        clearTimeout(timer);
        if (error) reject(new Error(str(obj(error).message) ?? "error de Moonraker"));
        else resolve(result);
      });
      ws.send(JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}), id }));
    });

  const resolveUrl = (value: unknown) => {
    const s = str(value, 500);
    if (!s) return undefined;
    try {
      const url = new URL(s, `${httpBase}/`);
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  };

  const loadMeta = async (file: string) => {
    metaFor = file;
    meta = undefined;
    try {
      const m = obj(await call("server.files.metadata", { filename: file }));
      const thumbs = arr(m.thumbnails).map(obj).sort((a, b) => (num(b.width) ?? 0) - (num(a.width) ?? 0));
      const rel = str(thumbs[0]?.relative_path, 300);
      const dir = file.includes("/") ? `${file.slice(0, file.lastIndexOf("/"))}/` : "";
      meta = {
        estimated_time: num(m.estimated_time),
        filament_total: num(m.filament_total),
        filament_weight_total: num(m.filament_weight_total),
        layer_count: num(m.layer_count),
        thumbnailUrl: rel ? resolveUrl(`server/files/gcodes/${(dir + rel).split("/").map(encodeURIComponent).join("/")}`) : undefined,
      };
      emit();
    } catch {
      /* archivo sin metadatos: se sigue sin ellos */
    }
  };

  const subscribe = async () => {
    const list = arr(obj(await call("printer.objects.list")).objects).map(String);
    const has = (name: string) => list.includes(name);
    chamberKey =
      list.find((n) => n === "heater_generic chamber") ??
      list.find((n) => /^heater_generic .*chamber/i.test(n)) ??
      list.find((n) => /^temperature_fan .*chamber/i.test(n)) ??
      list.find((n) => /^temperature_sensor .*chamber/i.test(n));
    const generic = list.filter((n) => n.startsWith("fan_generic "));
    fanKey = has("fan") ? "fan" : (generic.find((n) => n === "fan_generic cooling_fan") ?? generic.find((n) => /part|cooling|model/i.test(n)) ?? generic[0]);
    const wanted = ["webhooks", "print_stats", "display_status", "virtual_sdcard", "heater_bed", "gcode_move", "toolhead", "idle_timeout", "extruder", "extruder1", chamberKey, fanKey].filter((n): n is string => Boolean(n) && has(n as string));
    const result = obj(await call("printer.objects.subscribe", { objects: Object.fromEntries(wanted.map((n) => [n, null])) }));
    S = obj(result.status);
    emit();
  };

  const init = async () => {
    await call("server.connection.identify", { client_name: "Easy 3D", version: "0.1.0", type: "other", url: "https://github.com/Serpa22/Easy-3D", ...(apiKey ? { api_key: apiKey } : {}) }).catch(() => {});
    const info = obj(await call("server.info"));
    klippyState = str(info.klippy_state);
    await call("printer.info").then((p) => {
      const version = str(obj(p).software_version, 50);
      firmware = version ? `Klipper ${version}` : undefined;
    }).catch(() => {});
    await call("server.webcams.list").then((w) => {
      const cam = arr(obj(w).webcams).map(obj).find((c) => c.enabled !== false);
      cameraUrl = resolveUrl(cam?.snapshot_url) ?? resolveUrl(cam?.stream_url);
    }).catch(() => {});
    if (klippyState === "ready") await subscribe();
    else {
      S = { webhooks: { state: klippyState ?? "disconnected", state_message: info.klippy_connected === false ? "Klipper desconectado" : undefined } };
      emit();
    }
  };

  const scheduleReconnect = () => {
    if (stopped || retry) return;
    retry = setTimeout(() => {
      retry = undefined;
      void connect();
    }, backoffMs(attempt++));
  };

  const connect = async () => {
    if (stopped) return;
    let url = `${secure ? "wss" : "ws"}://${authority}/websocket`;
    try {
      if (apiKey) {
        // Con clave API se pide un token de un solo uso para abrir el WebSocket.
        const res = await fetch(`${httpBase}/access/oneshot_token`, { headers: { "X-Api-Key": apiKey }, signal: AbortSignal.timeout(8000) });
        if (res.status === 401 || res.status === 403) {
          offline("Moonraker ha rechazado la clave API.");
          return scheduleReconnect();
        }
        if (res.ok) url += `?token=${encodeURIComponent(String(obj(await res.json()).result ?? ""))}`;
      }
    } catch {
      offline();
      return scheduleReconnect();
    }
    if (stopped) return;
    const socket = new WebSocket(url, { handshakeTimeout: 10_000 });
    ws = socket;
    socket.on("open", () => {
      attempt = 0;
      init().catch((error) => {
        ctx.log("warn", `No se pudo iniciar la sesión: ${error instanceof Error ? error.message : String(error)}`);
        socket.terminate();
      });
    });
    socket.on("message", (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = obj(JSON.parse(data.toString()));
      } catch {
        return;
      }
      if (typeof msg.id === "number" && pending.has(msg.id)) {
        const done = pending.get(msg.id)!;
        pending.delete(msg.id);
        return done(msg.result, msg.error);
      }
      const params = arr(msg.params);
      switch (msg.method) {
        case "notify_status_update":
          deepMerge(S, obj(params[0]));
          {
            const file = str(obj(S.print_stats).filename);
            if (file && file !== metaFor) void loadMeta(file);
            if (!file) {
              meta = undefined;
              metaFor = undefined;
            }
          }
          emit();
          break;
        case "notify_klippy_ready":
          klippyState = "ready";
          subscribe().catch(() => socket.terminate());
          break;
        case "notify_klippy_shutdown":
          klippyState = "shutdown";
          deepMerge(S, { webhooks: { state: "shutdown" } });
          emit();
          break;
        case "notify_klippy_disconnected":
          klippyState = "disconnected";
          S = { webhooks: { state: "disconnected" } };
          emit();
          break;
      }
    });
    socket.on("unexpected-response", (_req, res) => {
      if (res.statusCode === 401 || res.statusCode === 403) offline("Moonraker requiere una clave API válida.");
    });
    socket.on("error", (error) => ctx.log("warn", `WebSocket: ${error.message}`));
    socket.on("close", () => {
      for (const done of pending.values()) done(undefined, { message: "conexión cerrada" });
      pending.clear();
      if (ws === socket) ws = undefined;
      if (stopped) return;
      offline();
      scheduleReconnect();
    });
  };

  return {
    start() {
      if (!rawHost) return offline("Falta la dirección de Moonraker.");
      offline();
      void connect();
      ping = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.ping();
      }, 20_000);
      ping.unref?.();
    },
    async stop() {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (ping) clearInterval(ping);
      ws?.removeAllListeners();
      ws?.on("error", () => {});
      ws?.terminate();
    },
  };
};
