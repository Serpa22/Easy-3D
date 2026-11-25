"use client";

/**
 * Estado en directo de las máquinas en el navegador.
 *
 * `LiveProvider` recibe una instantánea inicial del servidor y la refresca
 * consultando `/api/live` cada pocos segundos mientras la pestaña está visible.
 * Cualquier componente cliente lee el estado con `useLiveMachines()` /
 * `useLiveMachine(id)`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { LiveMachine, LiveSnapshot } from "@/lib/telemetry";

interface LiveContextValue {
  machines: LiveMachine[];
  byId: Map<string, LiveMachine>;
  /** Hora del servidor (ms) de la última instantánea. */
  serverTime: number;
  /** false si la última consulta falló (sin red, sesión caducada…). */
  online: boolean;
  /** Fuerza una actualización inmediata. */
  refresh: () => void;
}

const LiveContext = createContext<LiveContextValue | null>(null);

export interface LiveProviderProps {
  initial: LiveSnapshot;
  /** Slug de la sub-empresa; sin él se siguen todas (vista de grupo). */
  company?: string;
  /** Intervalo de refresco en ms. */
  intervalMs?: number;
  children: React.ReactNode;
}

export function LiveProvider({ initial, company, intervalMs = 3000, children }: LiveProviderProps) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot>(initial);
  const [online, setOnline] = useState(true);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const url = company ? `/api/live?company=${encodeURIComponent(company)}` : "/api/live";
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      setSnapshot((await response.json()) as LiveSnapshot);
      setOnline(true);
    } catch {
      setOnline(false);
    } finally {
      inFlight.current = false;
    }
  }, [company]);

  // Si el servidor vuelve a renderizar con datos más nuevos, se adoptan (ajuste durante el render).
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    if (initial.serverTime > snapshot.serverTime) setSnapshot(initial);
  }

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer) return;
      timer = setInterval(load, intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onVisibility);
    };
  }, [load, intervalMs]);

  const value = useMemo<LiveContextValue>(
    () => ({
      machines: snapshot.machines,
      byId: new Map(snapshot.machines.map((m) => [m.machineId, m])),
      serverTime: Date.parse(snapshot.serverTime),
      online,
      refresh: () => void load(),
    }),
    [snapshot, online, load],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

function useLiveContext(): LiveContextValue {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive… debe usarse dentro de <LiveProvider>");
  return ctx;
}

/** Todas las máquinas del ámbito del proveedor. */
export function useLiveMachines(): LiveContextValue {
  return useLiveContext();
}

/** Estado en directo de una máquina (undefined si no existe en el ámbito). */
export function useLiveMachine(machineId: string): LiveMachine | undefined {
  return useLiveContext().byId.get(machineId);
}
