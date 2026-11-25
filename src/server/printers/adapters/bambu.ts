/**
 * Bambu Lab por red local: MQTT 3.1.1 sobre TLS en el puerto 8883.
 * Usuario «bblp», contraseña = código de acceso LAN, tema `device/<serie>/report`.
 * Solo lectura: no envía órdenes a la impresora (salvo pedir el estado completo).
 *
 * Las series P1/A1 solo envían lo que cambia, así que se mantiene un estado
 * fusionado y la telemetría se calcula siempre a partir de él.
 */
import { randomUUID } from "node:crypto";
import mqtt, { type MqttClient } from "mqtt";
import type { PrinterState } from "../../../lib/domain";
import type { PrinterTelemetry, TelemetryFilament } from "../../../lib/telemetry";
import type { AdapterFactory } from "../types";
import { arr, backoffMs, num, obj, str } from "./_shared";

const STAGES: Record<number, string> = {
  1: "Nivelando la cama", 2: "Precalentando la cama", 3: "Compensación de vibraciones", 4: "Cambiando filamento", 5: "Pausa (M400)",
  6: "Pausa: se acabó el filamento", 7: "Calentando la boquilla", 8: "Calibrando el flujo", 9: "Escaneando la cama", 10: "Inspeccionando la primera capa",
  11: "Identificando la placa", 12: "Calibrando el micro lidar", 13: "Buscando el origen", 14: "Limpiando la boquilla", 15: "Comprobando la temperatura del extrusor",
  16: "Pausada por el usuario", 17: "Pausa: tapa frontal caída", 18: "Calibrando el micro lidar", 19: "Calibrando el caudal", 20: "Pausa: fallo de temperatura de la boquilla",
  21: "Pausa: fallo de temperatura de la cama", 22: "Descargando filamento", 23: "Pausa: pérdida de pasos", 24: "Cargando filamento", 25: "Cancelación de ruido del motor",
  26: "Pausa: AMS desconectado", 27: "Pausa: ventilador del disipador lento", 28: "Pausa: problema de temperatura de la cámara", 29: "Enfriando la cámara", 30: "Pausa (G-code del usuario)",
  32: "Pausa: acumulación en la boquilla", 33: "Pausa: error del cortador", 34: "Pausa: error en la primera capa", 35: "Pausa: boquilla obstruida",
  49: "Calentando la cámara", 50: "Ajustando la temperatura de la cama", 51: "Imprimiendo líneas de calibración", 54: "Esperando la temperatura de la cama", 77: "Preparando el AMS",
};
const PAUSE_STAGES = new Set([5, 6, 16, 17, 20, 21, 23, 26, 27, 28, 30, 32, 33, 34, 35]);
const IDLE_STAGES = new Set([0, -1, 255]);
/** Códigos que son acciones del usuario (cancelar), no fallos. */
const CANCEL_ERRORS = new Set([0x0300400c, 0x0500400e]);
/** «Inspeccionando la primera capa»: estado, no error. */
const HMS_IGNORE = new Set(["0C0003000003000B"]);
const SEVERITY: Record<number, string> = { 1: "Error grave", 2: "Error", 3: "Aviso" };

const hex = (n: number, digits: number) => (n >>> 0).toString(16).toUpperCase().padStart(digits, "0");
const group4 = (s: string) => s.replace(/(.{4})(?=.)/g, "$1_");

/** Valor empaquetado del formato nuevo: 16 bits bajos = actual, 16 altos = objetivo. */
function packed(value: unknown): { current: number; target: number } | undefined {
  const v = num(value);
  return v === undefined ? undefined : { current: v & 0xffff, target: (v >> 16) & 0xffff };
}

function tray(t: Record<string, unknown>, slot: string, active: boolean): TelemetryFilament | null {
  const type = str(t.tray_type, 40);
  if (!type) return null; // hueco vacío
  const color = str(t.tray_color, 8);
  const remain = num(t.remain);
  const tag = str(t.tag_uid, 40);
  return {
    slot,
    type,
    name: str(t.tray_sub_brands, 80) ?? type,
    ...(color && /^[0-9a-fA-F]{6}/.test(color) && color.slice(0, 8) !== "00000000" ? { color: `#${color.slice(0, 6).toLowerCase()}` } : {}),
    // «remain» solo es fiable con bobinas con etiqueta RFID.
    ...(remain !== undefined && remain >= 0 && remain <= 100 && tag && !/^0+$/.test(tag) ? { remainingPct: remain } : {}),
    ...(active ? { active: true } : {}),
  };
}

export interface BambuContext {
  /** Instante (ms) en que empezó el trabajo actual, para calcular el tiempo transcurrido. */
  startedAtMs?: number;
  nowMs: number;
  firmware?: string;
  /** Se vio una cancelación del usuario para este trabajo. */
  cancelled?: boolean;
}

/** Traduce el objeto `print` fusionado al modelo común. Función pura. */
export function mapBambu(print: Record<string, unknown>, ctx: BambuContext): PrinterTelemetry {
  const gcodeState = str(print.gcode_state, 20)?.toUpperCase() ?? "";
  const stage = num(print.stg_cur);
  const layer = num(print.layer_num) ?? 0;
  const stageText = stage !== undefined && !IDLE_STAGES.has(stage) ? (STAGES[stage] ?? `Etapa ${stage}`) : undefined;
  const printError = num(print.print_error) ?? 0;

  let state: PrinterState;
  let stateDetail: string | undefined;
  switch (gcodeState) {
    case "IDLE":
    case "INIT":
      state = "idle";
      break;
    case "SLICING":
      state = "preparing";
      stateDetail = "Laminando";
      break;
    case "PREPARE": {
      state = "preparing";
      const pct = num(print.gcode_file_prepare_percent);
      stateDetail = pct !== undefined && pct < 100 ? `Preparando el archivo (${Math.round(pct)} %)` : "Preparando";
      break;
    }
    case "RUNNING":
      if (stage !== undefined && PAUSE_STAGES.has(stage)) state = "paused";
      else if (stage === undefined || IDLE_STAGES.has(stage)) state = "printing";
      else state = layer > 0 ? "printing" : "preparing";
      stateDetail = stageText;
      break;
    case "PAUSE":
      state = "paused";
      stateDetail = stageText ?? "En pausa";
      break;
    case "FINISH":
      state = "finished";
      break;
    case "FAILED":
      if (ctx.cancelled || CANCEL_ERRORS.has(printError)) {
        state = "idle";
        stateDetail = "Cancelada";
      } else state = "error";
      break;
    case "OFFLINE":
      state = "offline";
      break;
    default:
      state = gcodeState ? "idle" : "offline";
      stateDetail = gcodeState ? undefined : "Esperando el estado de la impresora";
  }

  const out: PrinterTelemetry = { state, ...(stateDetail ? { stateDetail } : {}) };
  const device = obj(print.device);

  // Trabajo: solo mientras hay algo que contar (un equipo en reposo arrastra valores antiguos).
  if (state !== "idle" && state !== "offline") {
    const file = str(print.gcode_file);
    const title = str(print.subtask_name);
    const ramdisk = file?.startsWith("/data/") || file?.startsWith("/");
    const remainingMin = num(print.mc_remaining_time);
    const totalLayers = num(print.total_layer_num) ?? 0;
    const start = num(print.gcode_start_time);
    const startedMs = start && start > 0 ? start * 1000 : ctx.startedAtMs;
    out.job = {
      ...(ramdisk ? (title ? { fileName: `${title}.3mf` } : {}) : file ? { fileName: file } : {}),
      ...(title ? { title } : {}),
      ...(num(print.mc_percent) !== undefined ? { progress: num(print.mc_percent) } : {}),
      ...(layer > 0 ? { layer } : {}),
      ...(totalLayers > 0 ? { totalLayers } : {}),
      ...(remainingMin !== undefined ? { remainingSec: remainingMin * 60 } : {}),
      ...(startedMs && ctx.nowMs >= startedMs ? { elapsedSec: Math.round((ctx.nowMs - startedMs) / 1000) } : {}),
    };
  }

  // Temperaturas: formato nuevo (empaquetado) o campos clásicos.
  const extruder = obj(device.extruder);
  const extruders = arr(extruder.info);
  const activeIndex = ((num(extruder.state) ?? 0) >> 4) & 0xf;
  const activeExtruder = obj(extruders.find((e) => num(obj(e).id) === activeIndex) ?? extruders[0]);
  const nozzleP = packed(activeExtruder.temp);
  const bedP = packed(obj(obj(device.bed).info).temp);
  const chamberP = packed(obj(obj(device.ctc).info).temp);
  const nozzle = nozzleP ?? (num(print.nozzle_temper) !== undefined ? { current: num(print.nozzle_temper)!, target: num(print.nozzle_target_temper) ?? 0 } : undefined);
  const bed = bedP ?? (num(print.bed_temper) !== undefined ? { current: num(print.bed_temper)!, target: num(print.bed_target_temper) ?? 0 } : undefined);
  const chamberLegacy = num(print.chamber_temper);
  // En P1/A1 la cámara es un valor de relleno (≈5 °C): se descarta lo inverosímil.
  const chamber = chamberP ?? (chamberLegacy !== undefined && chamberLegacy >= 10 ? { current: chamberLegacy } : undefined);
  if (nozzle || bed || chamber) out.temps = { ...(nozzle ? { nozzle } : {}), ...(bed ? { bed } : {}), ...(chamber ? { chamber } : {}) };

  const speed = num(print.spd_mag);
  if (speed !== undefined && speed > 0) out.speedPct = speed;
  const fanGear = num(print.fan_gear);
  const fanLegacy = num(print.cooling_fan_speed);
  if (fanGear !== undefined) out.fanPct = Math.round(((fanGear & 0xff) / 255) * 100);
  else if (fanLegacy !== undefined) out.fanPct = Math.round((fanLegacy / 15) * 100);

  // Filamento: unidades AMS + bobina externa.
  const ams = obj(print.ams);
  const units = arr(ams.ams).map(obj);
  const trayNow = num(ams.tray_now);
  let activeUnit: number | undefined;
  let activeTray: number | undefined;
  const snow = num(activeExtruder.snow);
  if (snow !== undefined && extruders.length > 0) {
    activeUnit = snow >> 8;
    activeTray = snow & 0xff;
  } else if (trayNow !== undefined && trayNow !== 255) {
    if (trayNow === 254) activeUnit = 254;
    else if (trayNow >= 128) [activeUnit, activeTray] = [trayNow, 0];
    else [activeUnit, activeTray] = [trayNow >> 2, trayNow & 3];
  }
  const filament: TelemetryFilament[] = [];
  for (const unit of units) {
    const unitId = num(unit.id) ?? 0;
    for (const t of arr(unit.tray).map(obj)) {
      const trayId = num(t.id) ?? 0;
      const slot = unitId >= 128 ? `AMS HT ${unitId - 127}` : `AMS ${unitId + 1} · ${trayId + 1}`;
      const entry = tray(t, slot, activeUnit === unitId && activeTray === trayId);
      if (entry) filament.push(entry);
    }
  }
  const externals = arr(print.vir_slot).map(obj);
  const external = externals.length > 0 ? externals : print.vt_tray ? [obj(print.vt_tray)] : [];
  for (const t of external) {
    const id = num(t.id) ?? 254;
    const isActive = activeUnit === id || (units.length === 0 && extruders.length <= 1) || (trayNow === 254 && externals.length === 0);
    const entry = tray(t, external.length > 1 ? `Externa ${id === 255 ? 1 : 2}` : "Externa", Boolean(isActive));
    if (entry) filament.push(entry);
  }
  if (filament.length > 0) out.filament = filament;

  // Errores: lista HMS (grave / error / aviso) y código de error de impresión.
  const errors: NonNullable<PrinterTelemetry["errors"]> = [];
  for (const h of arr(print.hms).map(obj)) {
    const attr = num(h.attr);
    const code = num(h.code);
    if (attr === undefined || code === undefined) continue;
    const full = `${hex(attr, 8)}${hex(code, 8)}`;
    const severity = code >>> 16;
    if (HMS_IGNORE.has(full) || !SEVERITY[severity]) continue;
    errors.push({ code: `HMS_${group4(full)}`, message: `${SEVERITY[severity]} de la impresora (HMS ${group4(full)}). Consulta el código en la pantalla o en la wiki de Bambu Lab.` });
  }
  if (printError !== 0 && !CANCEL_ERRORS.has(printError) && (state === "error" || state === "paused")) {
    const code = group4(hex(printError, 8));
    errors.push({ code, message: `La impresión se detuvo con el código ${code}.` });
  }
  if (state === "error" && errors.length === 0) errors.push({ message: "La impresión ha fallado." });
  if (errors.length > 0) out.errors = errors;

  if (ctx.firmware) out.firmware = ctx.firmware;
  return out;
}

/** Fusiona actualizaciones parciales; las listas de objetos con `id` se fusionan por id. */
export function mergeBambu(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(patch)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const current = target[key];
    if (Array.isArray(value)) {
      const byId = value.length > 0 && value.every((v) => v && typeof v === "object" && "id" in (v as object));
      // `hms` es siempre la lista completa; el resto de listas con id (AMS, bandejas) llegan parciales.
      if (byId && key !== "hms" && Array.isArray(current)) {
        const list = current as Array<Record<string, unknown>>;
        for (const item of value as Array<Record<string, unknown>>) {
          const existing = list.find((x) => String(x.id) === String(item.id));
          if (existing) mergeBambu(existing, item);
          else list.push(item);
        }
      } else target[key] = value;
    } else if (value && typeof value === "object" && current && typeof current === "object" && !Array.isArray(current)) {
      mergeBambu(current as Record<string, unknown>, value as Record<string, unknown>);
    } else target[key] = value;
  }
  return target;
}

export const createAdapter: AdapterFactory = (ctx) => {
  const host = str(ctx.config.host);
  const serial = str(ctx.config.serial);
  const accessCode = str(ctx.config.accessCode);
  const port = num(ctx.config.port) ?? 8883;
  let client: MqttClient | undefined;
  let stopped = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let lastMessageAt = 0;
  let lastPushAll = 0;
  const print: Record<string, unknown> = {};
  let firmware: string | undefined;
  let startedAtMs: number | undefined;
  let cancelled = false;
  let previous: PrinterState = "offline";

  const offline = (message?: string) => ctx.onTelemetry({ state: "offline", ...(message ? { errors: [{ message }] } : {}) });
  const request = (payload: unknown) => client?.publish(`device/${serial}/request`, JSON.stringify(payload));
  const pushAll = () => {
    lastPushAll = Date.now();
    request({ pushing: { sequence_id: "0", command: "pushall", version: 1, push_target: 1 } });
  };

  const emit = () => {
    const t = mapBambu(print, { startedAtMs, nowMs: Date.now(), firmware, cancelled });
    const active = (s: PrinterState) => s === "preparing" || s === "printing" || s === "paused";
    if (active(t.state) && !active(previous)) {
      startedAtMs = Date.now();
      cancelled = false;
    }
    if (!active(t.state)) startedAtMs = t.state === "finished" || t.state === "error" ? startedAtMs : undefined;
    previous = t.state;
    ctx.onTelemetry(t);
  };

  const scheduleReconnect = (delayMs?: number) => {
    if (stopped || retry) return;
    retry = setTimeout(() => {
      retry = undefined;
      connect();
    }, delayMs ?? backoffMs(attempt++));
  };

  const connect = () => {
    if (stopped) return;
    try {
      client?.removeAllListeners();
      client?.end(true);
    } catch {
      /* ya cerrado */
    }
    // El certificado lo firma la CA propia de Bambu (CN = número de serie): no se puede
    // validar contra las CA públicas. TLS 1.3 cuelga en algunos modelos: se limita a 1.2.
    client = mqtt.connect({
      protocol: "mqtts",
      host,
      port,
      username: "bblp",
      password: accessCode,
      clientId: `easy3d_${randomUUID().slice(0, 12)}`,
      protocolVersion: 4,
      clean: true,
      keepalive: 30,
      connectTimeout: 10_000,
      reconnectPeriod: 0,
      rejectUnauthorized: false,
      maxVersion: "TLSv1.2",
    } as mqtt.IClientOptions);

    client.on("connect", () => {
      attempt = 0;
      lastMessageAt = Date.now();
      client?.subscribe(`device/${serial}/report`, { qos: 0 }, (error) => {
        if (error) ctx.log("warn", `No se pudo suscribir al estado: ${error.message}`);
      });
      request({ info: { sequence_id: "0", command: "get_version" } });
      pushAll();
    });
    client.on("message", (_topic, payload) => {
      lastMessageAt = Date.now();
      let message: Record<string, unknown>;
      try {
        message = obj(JSON.parse(payload.toString("utf8")));
      } catch {
        return;
      }
      const info = obj(message.info);
      const ota = arr(info.module).map(obj).find((m) => m.name === "ota");
      if (ota) firmware = str(ota.sw_ver, 40);
      if (message.print && typeof message.print === "object") {
        const patch = obj(message.print);
        // Orden de parada enviada desde otra app: la impresión se cancela, no falla.
        if (patch.command === "stop") cancelled = true;
        if (patch.command === undefined || patch.command === "push_status") mergeBambu(print, patch);
        emit();
      }
    });
    client.on("error", (error: Error & { code?: number }) => {
      if (error.code === 5 || error.code === 4 || /not authorized|bad user/i.test(error.message)) {
        offline("La impresora ha rechazado el código de acceso. Compruébalo en la pantalla (Ajustes → Red).");
        ctx.log("warn", "Código de acceso rechazado");
        try {
          client?.end(true);
        } catch {
          /* ya cerrado */
        }
        scheduleReconnect(60_000);
        return;
      }
      ctx.log("warn", `MQTT: ${error.message}`);
    });
    client.on("close", () => {
      if (stopped) return;
      offline();
      scheduleReconnect();
    });
  };

  return {
    start() {
      if (!host || !serial || !accessCode) return offline("Faltan la dirección IP, el número de serie o el código de acceso.");
      offline();
      connect();
      watchdog = setInterval(() => {
        if (stopped || !client?.connected) return;
        const now = Date.now();
        if (now - lastMessageAt > 60_000) {
          ctx.log("warn", "Sin mensajes en 60 s: reconectando");
          offline();
          connect();
        } else if (now - lastPushAll > 300_000) pushAll(); // estado completo de vez en cuando (sin abusar: P1/A1 lo limitan)
      }, 10_000);
      watchdog.unref?.();
    },
    async stop() {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (watchdog) clearInterval(watchdog);
      await new Promise<void>((resolve) => {
        if (!client) return resolve();
        client.removeAllListeners();
        client.on("error", () => {});
        client.end(true, {}, () => resolve());
        setTimeout(resolve, 1500).unref?.();
      });
    },
  };
};
