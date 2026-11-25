/**
 * Impresora simulada. Su telemetría es una FUNCIÓN PURA de (semilla, velocidad,
 * hora), así que sobrevive a reinicios y dos procesos ven lo mismo.
 *
 * El tiempo simulado se divide en «turnos» de 6 h. En cada turno:
 * reposo → preparación → impresión (con alguna pausa) → terminada → reposo.
 * Aproximadamente 1 de cada 15 trabajos falla.
 */
import type { PrinterTelemetry } from "../../../lib/telemetry";
import type { AdapterFactory } from "../types";
import { num, round } from "./_shared";

const SLOT = 6 * 3600; // segundos simulados por turno

const FDM_JOBS = [
  "set_teclas_cherry_v3", "keycap_artisan_dragon", "barra_espaciadora_625", "set_tkl_87_negro", "flechas_translucidas_x5",
  "tecla_escape_silk", "reposamunecas_tpu", "extractor_teclas_x8", "expositor_12_teclas", "artisan_gato_x6",
  "artisan_montana_x6", "carcasa_macropad_v2",
];
const RESIN_JOBS = [
  "caballeros_errantes_x8", "hechicera_pantano_x8", "escuadra_goblins_x4", "dragon_joven_120", "busto_guardiana",
  "peanas_texturizadas_x6", "ruinas_modulares_basico", "base_figura_caballero",
];
const FILAMENTS = [
  { type: "PLA", name: "PLA Negro mate", color: "#111111" },
  { type: "PLA", name: "PLA Blanco hueso", color: "#f2efe6" },
  { type: "PETG", name: "PETG Translúcido", color: "#cfe3ea" },
  { type: "PLA", name: "PLA Silk Dorado", color: "#c9a13b" },
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a de una cadena → entero de 32 bits. */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const range = (rng: () => number, min: number, max: number) => min + rng() * (max - min);
const wave = (t: number, period: number, amp: number) => Math.sin((t / period) * 2 * Math.PI) * amp;

export function simulateTelemetry(seed: number, speed: number, nowMs: number, profile: "fdm" | "resin" = "fdm"): PrinterTelemetry {
  const s = Math.max(0.01, speed);
  // Desfase por máquina para que no arranquen todas a la vez.
  const virtual = (nowMs / 1000) * s + (seed % SLOT);
  const slot = Math.floor(virtual / SLOT);
  const t = virtual - slot * SLOT;
  const rng = mulberry32((seed ^ Math.imul(slot + 1, 0x9e3779b1)) >>> 0);

  const resin = profile === "resin";
  const idleBefore = range(rng, 2 * 60, 22 * 60);
  const prep = range(rng, 4 * 60, 8 * 60);
  const duration = range(rng, 35 * 60, 4.6 * 3600);
  const finishedFor = range(rng, 4 * 60, 10 * 60);
  const jobName = (resin ? RESIN_JOBS : FDM_JOBS)[Math.floor(rng() * (resin ? RESIN_JOBS : FDM_JOBS).length)];
  const version = 1 + Math.floor(rng() * 4);
  const filament = FILAMENTS[Math.floor(rng() * FILAMENTS.length)];
  const totalGrams = range(rng, 20, 180);
  const hasPause = rng() < 0.2;
  const pauseAt = range(rng, 0.25, 0.75) * duration;
  const pauseLen = hasPause ? range(rng, 3 * 60, 6 * 60) : 0;
  const fails = rng() < 1 / 15;
  const failAt = range(rng, 0.2, 0.8) * duration;
  const layerSec = resin ? 9 : range(rng, 22, 40);
  const totalLayers = Math.max(20, Math.round(duration / layerSec));
  const nozzleTarget = resin ? 0 : filament.type === "PETG" ? 240 : 215;
  const bedTarget = resin ? 0 : filament.type === "PETG" ? 75 : 60;
  const ambient = 24;
  const fileName = `${jobName}_v${version}.${resin ? "ctb" : "3mf"}`;
  const slots = resin ? undefined : [{ slot: "AMS 1 · 1", type: filament.type, name: filament.name, color: filament.color, remainingPct: 20 + (seed % 70), active: true }];

  const temps = (nozzle: number, bed: number, heating: boolean) =>
    resin
      ? { chamber: { current: round(27 + wave(virtual, 900, 0.6)) } }
      : {
          nozzle: { current: round(nozzle + wave(virtual, 37, 0.8)), target: heating ? nozzleTarget : 0 },
          bed: { current: round(bed + wave(virtual, 61, 0.3)), target: heating ? bedTarget : 0 },
          chamber: { current: round(29 + wave(virtual, 1200, 1.5)) },
        };
  const idle = (): PrinterTelemetry => ({ state: "idle", temps: temps(ambient, ambient, false), filament: slots, firmware: "sim-1.0" });

  let offset = t - idleBefore;
  if (offset < 0) return idle();

  const job = (printed: number) => {
    const progress = Math.min(100, (printed / duration) * 100);
    return {
      fileName,
      title: `${jobName}_v${version}`,
      progress: round(progress),
      layer: Math.min(totalLayers, Math.max(1, Math.round((progress / 100) * totalLayers))),
      totalLayers,
      elapsedSec: Math.round(printed + prep),
      remainingSec: Math.max(0, Math.round(duration - printed)),
      ...(resin ? {} : { filamentUsedG: round((totalGrams * progress) / 100) }),
    };
  };

  if (offset < prep) {
    const k = offset / prep;
    return {
      state: "preparing",
      stateDetail: resin ? "Comprobando cuba y plataforma" : k < 0.6 ? "Calentando cama" : k < 0.85 ? "Calentando boquilla" : "Nivelando",
      job: { fileName, title: `${jobName}_v${version}`, progress: 0, layer: 0, totalLayers, elapsedSec: Math.round(offset), remainingSec: Math.round(duration) },
      temps: temps(ambient + (nozzleTarget - ambient) * Math.max(0, (k - 0.5) * 2), ambient + (bedTarget - ambient) * Math.min(1, k * 1.6), true),
      filament: slots,
      speedPct: 100,
      firmware: "sim-1.0",
    };
  }
  offset -= prep;

  const printSpan = fails ? failAt : duration + pauseLen;
  if (offset < printSpan) {
    let printed = offset;
    let paused = false;
    if (!fails && hasPause) {
      if (offset >= pauseAt && offset < pauseAt + pauseLen) {
        paused = true;
        printed = pauseAt;
      } else if (offset >= pauseAt + pauseLen) {
        printed = offset - pauseLen;
      }
    }
    return {
      state: paused ? "paused" : "printing",
      ...(paused ? { stateDetail: "Pausa solicitada por el usuario" } : {}),
      job: job(printed),
      temps: temps(nozzleTarget, bedTarget, true),
      speedPct: 100,
      fanPct: resin ? undefined : paused ? 0 : Math.round(70 + wave(virtual, 240, 20)),
      filament: slots,
      firmware: "sim-1.0",
    };
  }
  offset -= printSpan;

  if (offset < finishedFor) {
    const k = offset / finishedFor;
    const cooling = temps(nozzleTarget - (nozzleTarget - ambient) * k, bedTarget - (bedTarget - ambient) * k * 0.6, false);
    if (fails) {
      return {
        state: "error",
        job: job(failAt),
        temps: cooling,
        filament: slots,
        errors: [{ code: resin ? "SIM-R01" : "SIM-F07", message: resin ? "Pieza despegada de la plataforma" : "Atasco de filamento detectado" }],
        firmware: "sim-1.0",
      };
    }
    return { state: "finished", job: { ...job(duration), progress: 100, remainingSec: 0 }, temps: cooling, filament: slots, firmware: "sim-1.0" };
  }
  return idle();
}

export const createAdapter: AdapterFactory = (ctx) => {
  let timer: ReturnType<typeof setInterval> | undefined;
  const speed = num(ctx.config.speed) ?? 4;
  const seed = seedFrom(ctx.machineId);
  const profile = ctx.meta?.technology === "resin" ? "resin" : "fdm";
  const tick = () => ctx.onTelemetry(simulateTelemetry(seed, speed, Date.now(), profile));
  return {
    start() {
      tick();
      timer = setInterval(tick, 1000);
      timer.unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
};
