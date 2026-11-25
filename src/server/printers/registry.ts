/** Mapa de tipo de conexión → adaptador (carga perezosa). */
import type { ConnectionType } from "../../lib/domain";
import type { AdapterFactory } from "./types";

const LOADERS: Record<Exclude<ConnectionType, "none">, () => Promise<{ createAdapter: AdapterFactory }>> = {
  simulator: () => import("./adapters/simulator"),
  bambu: () => import("./adapters/bambu"),
  moonraker: () => import("./adapters/moonraker"),
  octoprint: () => import("./adapters/octoprint"),
  prusalink: () => import("./adapters/prusalink"),
  elegoo: () => import("./adapters/elegoo"),
};

export async function loadAdapter(type: ConnectionType): Promise<AdapterFactory | null> {
  if (type === "none") return null;
  const loader = LOADERS[type];
  if (!loader) return null;
  return (await loader()).createAdapter;
}
