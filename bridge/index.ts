/**
 * Easy 3D · bridge
 *
 * Programa que corre en un ordenador o Raspberry Pi del taller, en la misma
 * red que las impresoras. Se conecta a ellas y reenvía la telemetría a la app
 * cuando esta vive en la nube y no puede alcanzar tu red local.
 *
 *   E3D_URL=https://tu-app.example E3D_BRIDGE_TOKEN=e3d_… npm run bridge
 */
import fs from "node:fs";
import { PrinterManager } from "../src/server/printers/manager";
import type { ManagedMachine, TelemetryItem } from "../src/server/printers/types";

const VERSION = "0.1.0";

function loadEnvFile() {
  const index = process.argv.indexOf("--env");
  const file = index >= 0 ? process.argv[index + 1] : undefined;
  if (!file) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !line.trim().startsWith("#")) process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
  }
}

const log = (level: "info" | "warn" | "error", message: string) => {
  const time = new Date().toLocaleTimeString("es-ES");
  console[level === "info" ? "log" : level](`${time}  ${level === "info" ? " " : "!"} ${message}`);
};

async function main() {
  loadEnvFile();
  const base = (process.env.E3D_URL ?? "").replace(/\/+$/, "");
  const token = process.env.E3D_BRIDGE_TOKEN ?? "";
  if (!/^https?:\/\//.test(base) || !token) {
    console.error("Faltan E3D_URL (dirección de la app) y/o E3D_BRIDGE_TOKEN (token del bridge, se crea en Ajustes → Conexiones).");
    process.exit(1);
  }
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Bridge-Version": VERSION };

  const manager = new PrinterManager(
    {
      async deliver(items: TelemetryItem[]) {
        const response = await fetch(`${base}/api/bridge/ingest`, { method: "POST", headers, body: JSON.stringify({ items }), signal: AbortSignal.timeout(15_000) });
        if (response.status === 401) throw new Error("token rechazado");
        if (!response.ok) throw new Error(`la app respondió ${response.status}`);
      },
    },
    log,
  );

  let known = "";
  let pollSec = 30;
  let failures = 0;
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const poll = async () => {
    if (stopping) return;
    try {
      const response = await fetch(`${base}/api/bridge/config`, { headers, signal: AbortSignal.timeout(15_000) });
      if (response.status === 401) {
        console.error("El token del bridge no es válido o se ha eliminado. Crea uno nuevo en Ajustes → Conexiones.");
        await manager.stop();
        process.exit(2);
      }
      if (!response.ok) throw new Error(`la app respondió ${response.status}`);
      const data = (await response.json()) as { bridge: { name: string }; machines: Array<{ id: string; name: string; technology: string; connectionType: ManagedMachine["connectionType"]; config: Record<string, unknown> }>; pollSec?: number };
      pollSec = Math.min(300, Math.max(10, data.pollSec ?? 30));
      const signature = JSON.stringify(data.machines.map((m) => [m.id, m.connectionType, m.config]));
      if (signature !== known) {
        known = signature;
        log("info", `Bridge «${data.bridge.name}»: ${data.machines.length} máquina(s) asignada(s)${data.machines.length ? ": " + data.machines.map((m) => m.name).join(", ") : ""}`);
        await manager.sync(data.machines.map((m) => ({ id: m.id, connectionType: m.connectionType, config: m.config ?? {}, meta: { name: m.name, technology: m.technology } })));
      }
      failures = 0;
    } catch (error) {
      failures += 1;
      log("warn", `No se pudo contactar con la app (${error instanceof Error ? error.message : String(error)}). Reintentando…`);
    }
    const delay = failures > 0 ? Math.min(60, 2 ** Math.min(failures, 6)) : pollSec;
    timer = setTimeout(poll, delay * 1000);
  };

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    log("info", "Cerrando conexiones…");
    await manager.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  log("info", `Easy 3D bridge ${VERSION} → ${base}`);
  await poll();
}

// Un fallo inesperado en una máquina no debe tumbar el bridge ni dejar sin
// seguimiento al resto de impresoras: se registra y se sigue.
process.on("unhandledRejection", (reason) => {
  log("error", `Error no controlado: ${reason instanceof Error ? reason.message : String(reason)}`);
});
process.on("uncaughtException", (error) => {
  log("error", `Excepción no controlada: ${error.message}`);
});

void main();
