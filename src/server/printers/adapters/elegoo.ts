/**
 * Elegoo con protocolo SDCP v3 (Saturn / Mars recientes, Centauri Carbon):
 * WebSocket en `ws://<ip>:3030/websocket` y descubrimiento por UDP (puerto 3000).
 *
 * EXPERIMENTAL: implementado a partir de la especificación pública, sin validar
 * con hardware real. Los códigos de estado se interpretan de forma defensiva.
 */
import dgram from "node:dgram";
import { randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { PrinterState } from "../../../lib/domain";
import type { PrinterTelemetry } from "../../../lib/telemetry";
import type { AdapterFactory } from "../types";
import { arr, backoffMs, num, obj, str, titleFromFile } from "./_shared";

const PAUSED = new Set([5, 6]);
const STOPPED = new Set([0, 7, 8]);
const PREPARING = new Set([1, 10, 16, 17, 18, 19, 20, 21]);

/** Traduce el objeto `Status` de SDCP al modelo común. Función pura. */
export function mapSdcp(statusObj: unknown, firmware?: string): PrinterTelemetry {
  const s = obj(statusObj);
  const current = Array.isArray(s.CurrentStatus) ? arr(s.CurrentStatus).map((v) => num(v) ?? -1) : [num(s.CurrentStatus) ?? 0];
  const info = obj(s.PrintInfo);
  const ps = num(info.Status) ?? 0;
  const printing = current.includes(1);
  const errorNumber = num(info.ErrorNumber) ?? 0;

  let state: PrinterState;
  let stateDetail: string | undefined;
  if (ps === 9) state = "finished";
  else if (PAUSED.has(ps)) state = "paused";
  else if (printing && PREPARING.has(ps)) {
    state = "preparing";
    stateDetail = ps === 1 ? "Buscando el origen" : ps === 10 ? "Comprobando el archivo" : "Preparando";
  } else if (printing && !STOPPED.has(ps)) state = "printing";
  else if (printing) state = "preparing";
  else if (errorNumber > 0 && ps !== 0) state = "error";
  else {
    state = "idle";
    if (current.includes(2)) stateDetail = "Recibiendo un archivo";
    else if (current.includes(3) || current.includes(4)) stateDetail = "Prueba del equipo";
  }

  const out: PrinterTelemetry = { state, ...(stateDetail ? { stateDetail } : {}) };
  const fileName = str(info.Filename);
  if (fileName && state !== "idle") {
    const layer = num(info.CurrentLayer);
    const total = num(info.TotalLayer);
    const ticks = num(info.CurrentTicks);
    const totalTicks = num(info.TotalTicks);
    // Los «ticks» van en milisegundos en resina y en segundos en algunos firmwares FDM.
    const div = totalTicks !== undefined && totalTicks >= 200_000 ? 1000 : 1;
    const progress = num(info.Progress) ?? (totalTicks && ticks !== undefined ? (ticks / totalTicks) * 100 : total && layer !== undefined ? (layer / total) * 100 : undefined);
    out.job = {
      fileName,
      title: titleFromFile(fileName),
      ...(progress !== undefined ? { progress: state === "finished" ? 100 : progress } : {}),
      ...(layer !== undefined ? { layer } : {}),
      ...(total ? { totalLayers: total } : {}),
      ...(ticks !== undefined ? { elapsedSec: ticks / div } : {}),
      ...(ticks !== undefined && totalTicks ? { remainingSec: Math.max(0, (totalTicks - ticks) / div) } : {}),
    };
  }

  const temps: NonNullable<PrinterTelemetry["temps"]> = {};
  if (num(s.TempOfNozzle) !== undefined) temps.nozzle = { current: num(s.TempOfNozzle)!, target: num(s.TempTargetNozzle) ?? 0 };
  if (num(s.TempOfHotbed) !== undefined) temps.bed = { current: num(s.TempOfHotbed)!, target: num(s.TempTargetHotbed) ?? 0 };
  if (num(s.TempOfBox) !== undefined && num(s.TempOfBox)! > 0) temps.chamber = { current: num(s.TempOfBox)!, ...(num(s.TempTargetBox) ? { target: num(s.TempTargetBox)! } : {}) };
  if (Object.keys(temps).length > 0) out.temps = temps;
  const fan = num(obj(s.CurrentFanSpeed).ModelFan);
  if (fan !== undefined) out.fanPct = fan;
  const speed = num(info.PrintSpeedPct);
  if (speed !== undefined && speed > 0) out.speedPct = speed;
  if (errorNumber > 0) out.errors = [{ code: String(errorNumber), message: `La impresora informa del error ${errorNumber}. Revisa su pantalla.` }];
  if (firmware) out.firmware = firmware;
  return out;
}

/** Pregunta a la impresora por UDP su identificador de placa (necesario para los mensajes). */
function discover(host: string, timeoutMs = 3000): Promise<{ mainboardId?: string; firmware?: string }> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const done = (result: { mainboardId?: string; firmware?: string }) => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* ya cerrado */
      }
      resolve(result);
    };
    const timer = setTimeout(() => done({}), timeoutMs);
    socket.on("error", () => done({}));
    socket.on("message", (message) => {
      try {
        const data = obj(obj(JSON.parse(message.toString("utf8"))).Data);
        const id = str(data.MainboardID, 80);
        if (id) done({ mainboardId: id, firmware: str(data.FirmwareVersion, 40) });
      } catch {
        /* respuesta no válida */
      }
    });
    socket.send("M99999", 3000, host, (error) => {
      if (error) done({});
    });
  });
}

export const createAdapter: AdapterFactory = (ctx) => {
  const host = str(ctx.config.host);
  let mainboardId = str(ctx.config.mainboardId, 80);
  let firmware: string | undefined;
  let ws: WebSocket | undefined;
  let stopped = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let lastMessageAt = 0;

  const offline = (message?: string) => ctx.onTelemetry({ state: "offline", ...(message ? { errors: [{ message }] } : {}) });
  const send = (cmd: number) => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !mainboardId) return;
    ws.send(
      JSON.stringify({
        Id: randomUUID().replace(/-/g, ""),
        Data: { Cmd: cmd, Data: {}, RequestID: randomBytes(16).toString("hex"), MainboardID: mainboardId, TimeStamp: Math.floor(Date.now() / 1000), From: 0 },
        Topic: `sdcp/request/${mainboardId}`,
      }),
    );
  };

  const scheduleReconnect = () => {
    if (stopped || retry) return;
    retry = setTimeout(() => {
      retry = undefined;
      void connect();
    }, backoffMs(attempt++));
  };

  const connect = async () => {
    if (stopped || !host) return;
    if (!mainboardId) {
      const found = await discover(host);
      mainboardId = found.mainboardId;
      firmware = found.firmware ?? firmware;
    }
    if (stopped) return;
    const socket = new WebSocket(`ws://${host}:3030/websocket`, { handshakeTimeout: 8000 });
    ws = socket;
    socket.on("open", () => {
      attempt = 0;
      lastMessageAt = Date.now();
      send(1); // atributos
      send(0); // estado
    });
    socket.on("message", (data) => {
      lastMessageAt = Date.now();
      const text = data.toString();
      if (text === "pong") return;
      let msg: Record<string, unknown>;
      try {
        msg = obj(JSON.parse(text));
      } catch {
        return;
      }
      // Algunos firmwares anuncian la placa en cualquier mensaje: se aprovecha si faltaba.
      const id = str(msg.MainboardID, 80) ?? str(obj(msg.Data).MainboardID, 80);
      if (!mainboardId && id) {
        mainboardId = id;
        send(0);
      }
      const attributes = obj(msg.Attributes);
      if (str(attributes.FirmwareVersion)) firmware = str(attributes.FirmwareVersion, 40);
      if (msg.Status && typeof msg.Status === "object") ctx.onTelemetry(mapSdcp(msg.Status, firmware));
    });
    socket.on("error", (error) => ctx.log("warn", `WebSocket: ${error.message}`));
    socket.on("close", () => {
      if (ws === socket) ws = undefined;
      if (stopped) return;
      offline();
      scheduleReconnect();
    });
  };

  return {
    start() {
      if (!host) return offline("Falta la dirección IP de la impresora.");
      offline();
      void connect();
      poll = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (Date.now() - lastMessageAt > 45_000) return ws.terminate();
        ws.send("ping");
        send(0);
      }, 5000);
      poll.unref?.();
    },
    async stop() {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (poll) clearInterval(poll);
      ws?.removeAllListeners();
      ws?.on("error", () => {});
      ws?.terminate();
    },
  };
};
