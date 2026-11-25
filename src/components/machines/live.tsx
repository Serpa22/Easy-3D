"use client";

/** Piezas en directo de las máquinas (leen el estado de <LiveProvider>). */
import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertCircle, Camera, CircleDot, Fan, Gauge, Layers, Pause, Play, Power, PowerOff, Printer, Square, Thermometer, Timer, WifiOff } from "lucide-react";
import { StackedBar } from "@/components/charts/simple";
import { useLiveMachine, useLiveMachines } from "@/components/live/live-provider";
import { RelativeTime } from "@/components/ui/client-bits";
import { Alert, Badge, Card, Progress, ProgressRing, StatusDot, type DotVariant } from "@/components/ui/display";
import { cn } from "@/lib/cn";
import { MACHINE_EVENT_LABELS, MACHINE_STATUS_LABELS, PRINTER_STATE_LABELS, WORKING_STATES, type MachineEventType, type MachineStatus, type PrinterState } from "@/lib/domain";
import { formatDateTime, formatDuration, formatTemp, formatTime, formatWeight } from "@/lib/format";
import type { LiveMachine } from "@/lib/telemetry";

type DotTone = "neutral" | "ok" | "warn" | "danger";
const VISUAL: Record<PrinterState, { variant: DotVariant; tone: DotTone }> = {
  printing: { variant: "pulse", tone: "neutral" },
  preparing: { variant: "pulse", tone: "neutral" },
  paused: { variant: "solid", tone: "warn" },
  finished: { variant: "solid", tone: "ok" },
  idle: { variant: "ring", tone: "neutral" },
  offline: { variant: "dashed", tone: "neutral" },
  error: { variant: "solid", tone: "danger" },
};

export function LiveState({ state, className }: { state: PrinterState; className?: string }) {
  const v = VISUAL[state];
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm font-medium", state === "error" ? "text-danger" : state === "offline" ? "text-fg-3" : "text-fg", className)}>
      <StatusDot variant={v.variant} tone={v.tone} />
      {PRINTER_STATE_LABELS[state]}
    </span>
  );
}

export interface MachineCardData {
  id: string;
  name: string;
  subtitle: string;
  status: MachineStatus;
  manual: boolean;
  loadedMaterial: string | null;
  href: string;
  /** Enlaces para máquinas manuales. */
  startHref?: string;
  finishHrefBase?: string;
}

/** Hora estimada de fin a partir de la hora del servidor y el tiempo restante. */
function eta(serverTime: number, remainingSec: number | undefined, timeZone: string): string | null {
  if (remainingSec === undefined) return null;
  return formatTime(new Date(serverTime + remainingSec * 1000), timeZone);
}

export type LiveFilter = "todas" | "trabajando" | "reposo" | "offline" | "error";
function matches(filter: LiveFilter, state: PrinterState): boolean {
  if (filter === "todas") return true;
  if (filter === "trabajando") return WORKING_STATES.includes(state);
  if (filter === "reposo") return state === "idle" || state === "finished";
  if (filter === "offline") return state === "offline";
  return state === "error";
}

/** Resumen en directo: cuántas máquinas trabajan, descansan, están sin conexión o con error. */
export function LiveSummary({ machineIds, className }: { machineIds?: string[]; className?: string }) {
  const { machines, online } = useLiveMachines();
  const scope = machineIds ? machines.filter((m) => machineIds.includes(m.machineId)) : machines;
  const working = scope.filter((m) => WORKING_STATES.includes(m.state)).length;
  const idle = scope.filter((m) => m.state === "idle" || m.state === "finished").length;
  const offline = scope.filter((m) => m.state === "offline").length;
  const error = scope.filter((m) => m.state === "error").length;
  return (
    <Card className={cn("p-5", className)}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-fg-2">
          <span className="font-mono text-2xl font-medium text-fg tabular">{working}</span> de <span className="font-mono text-fg tabular">{scope.length}</span>{" "}
          {scope.length === 1 ? "máquina trabajando" : "máquinas trabajando"} ahora
        </p>
        {!online ? (
          <Badge tone="warn" icon={<WifiOff />}>
            Sin conexión con el servidor
          </Badge>
        ) : (
          <span className="inline-flex items-center gap-2 text-[0.8125rem] text-fg-3">
            <StatusDot variant="pulse" /> En directo
          </span>
        )}
      </div>
      <StackedBar
        segments={[
          { label: "Trabajando", value: working },
          { label: "En reposo", value: idle },
          { label: "Sin conexión", value: offline },
          ...(error > 0 ? [{ label: "Con error", value: error, tone: "danger" as const }] : []),
        ]}
      />
    </Card>
  );
}

function JobLine({ live, timeZone, serverTime }: { live: LiveMachine; timeZone: string; serverTime: number }) {
  const job = live.telemetry?.job;
  const end = eta(serverTime, job?.remainingSec, timeZone);
  return (
    <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.8125rem] text-fg-2 tabular">
      {job?.layer !== undefined && job.totalLayers ? (
        <span>
          Capa {job.layer}/{job.totalLayers}
        </span>
      ) : null}
      {job?.remainingSec !== undefined ? <span>Quedan {formatDuration(job.remainingSec)}</span> : null}
      {end ? <span>Fin {end}</span> : null}
    </p>
  );
}

function MachineCard({ machine, timeZone }: { machine: MachineCardData; timeZone: string }) {
  const live = useLiveMachine(machine.id);
  const { serverTime } = useLiveMachines();
  const state: PrinterState = live?.state ?? "offline";
  const t = live?.telemetry;
  const job = t?.job;
  const working = WORKING_STATES.includes(state);
  return (
    <Card className="relative flex flex-col p-5 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <LiveState state={state} />
        <div className="flex flex-wrap justify-end gap-1.5">
          {machine.status !== "active" ? <Badge tone={machine.status === "maintenance" ? "warn" : "neutral"}>{MACHINE_STATUS_LABELS[machine.status]}</Badge> : null}
          {machine.manual ? <Badge tone="outline">Manual</Badge> : null}
        </div>
      </div>
      <h3 className="mt-3 text-base font-semibold">
        <Link href={machine.href} className="after:absolute after:inset-0 after:rounded-lg hover:underline">
          {machine.name}
        </Link>
      </h3>
      <p className="text-[0.8125rem] text-fg-3">{machine.subtitle}</p>

      <div className="mt-4 flex-1 border-t border-line pt-4">
        {working || state === "finished" ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-medium" title={job?.title ?? job?.fileName}>
                {job?.title ?? job?.fileName ?? "Impresión en curso"}
              </p>
              <span className="shrink-0 font-mono text-sm tabular">{job?.progress !== undefined ? `${Math.round(job.progress)} %` : "—"}</span>
            </div>
            <Progress value={job?.progress ?? null} label="Progreso de la impresión" tone={state === "paused" ? "warn" : state === "finished" ? "ok" : "neutral"} className="mt-2.5" />
            {state === "preparing" && t?.stateDetail ? <p className="mt-1.5 text-[0.8125rem] text-fg-2">{t.stateDetail}</p> : live ? <JobLine live={live} timeZone={timeZone} serverTime={serverTime} /> : null}
            {t?.temps?.nozzle || t?.temps?.bed ? (
              <p className="mt-1 text-[0.8125rem] text-fg-3 tabular">
                {t.temps.nozzle ? `Boquilla ${formatTemp(t.temps.nozzle.current)}` : ""}
                {t.temps.nozzle && t.temps.bed ? " · " : ""}
                {t.temps.bed ? `Cama ${formatTemp(t.temps.bed.current)}` : ""}
              </p>
            ) : null}
          </>
        ) : state === "error" ? (
          <p className="flex items-start gap-2 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t?.errors?.[0]?.message ?? "La impresora informa de un error"}
          </p>
        ) : state === "offline" ? (
          <p className="text-sm text-fg-3">
            {live?.updatedAt ? (
              <>
                Última señal <RelativeTime value={live.updatedAt} />
              </>
            ) : (
              "Todavía no se ha recibido señal de esta máquina."
            )}
          </p>
        ) : (
          <p className="text-sm text-fg-2">
            {live?.stateSince ? (
              <>
                En reposo desde <RelativeTime value={live.stateSince} />
              </>
            ) : (
              "Lista para imprimir"
            )}
            {machine.loadedMaterial ? <span className="mt-1 block text-[0.8125rem] text-fg-3">Cargado: {machine.loadedMaterial}</span> : null}
          </p>
        )}
      </div>

      {machine.manual && machine.status === "active" ? (
        <div className="relative z-10 mt-4">
          {live?.currentJobId && machine.finishHrefBase ? (
            <Link href={`${machine.finishHrefBase}${live.currentJobId}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-control px-3 text-sm hover:bg-hover active:bg-active pointer-coarse:h-11">
              <Square className="size-3.5" aria-hidden="true" /> Terminar impresión
            </Link>
          ) : machine.startHref ? (
            <Link href={machine.startHref} className="inline-flex h-9 items-center gap-2 rounded-md border border-control px-3 text-sm hover:bg-hover active:bg-active pointer-coarse:h-11">
              <Play className="size-3.5" aria-hidden="true" /> Iniciar impresión
            </Link>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/** Rejilla de máquinas en directo, con filtro por estado. */
export function MachineGrid({ machines, filter = "todas", timeZone }: { machines: MachineCardData[]; filter?: LiveFilter; timeZone: string }) {
  const { byId } = useLiveMachines();
  const visible = machines.filter((m) => matches(filter, byId.get(m.id)?.state ?? "offline"));
  if (visible.length === 0) {
    return <p className="rounded-lg border border-dashed border-line-strong px-6 py-10 text-center text-sm text-fg-2">Ninguna máquina en este estado ahora mismo.</p>;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {visible.map((m) => (
        <MachineCard key={m.id} machine={m} timeZone={timeZone} />
      ))}
    </div>
  );
}

/** Lista compacta de lo que se está imprimiendo ahora (panel del resumen). */
export function NowPrinting({ machines, timeZone, emptyHref }: { machines: Array<{ id: string; name: string; href: string; company?: string }>; timeZone: string; emptyHref?: string }) {
  const { byId, serverTime } = useLiveMachines();
  const rows = machines.map((m) => ({ ...m, live: byId.get(m.id) }));
  const working = rows.filter((r) => r.live && WORKING_STATES.includes(r.live.state));
  const others = rows.filter((r) => !r.live || !WORKING_STATES.includes(r.live.state));
  if (machines.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-fg-2">
        Aún no hay máquinas.{" "}
        {emptyHref ? (
          <Link href={emptyHref} className="font-medium text-fg underline underline-offset-4">
            Añade la primera
          </Link>
        ) : null}
      </p>
    );
  }
  return (
    <div className="flex flex-col">
      {working.length === 0 ? <p className="py-4 text-sm text-fg-2">Ninguna máquina imprimiendo en este momento.</p> : null}
      <ul className="divide-y divide-line">
        {working.map(({ live, ...m }) => {
          const job = live!.telemetry?.job;
          const end = eta(serverTime, job?.remainingSec, timeZone);
          return (
            <li key={m.id} className="relative flex items-center gap-4 py-3.5 first:pt-0">
              <ProgressRing value={job?.progress ?? 0} size={52} stroke={5} label={`Progreso ${Math.round(job?.progress ?? 0)} %`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  <Link href={m.href} className="after:absolute after:inset-0 hover:underline">
                    {job?.title ?? job?.fileName ?? "Impresión en curso"}
                  </Link>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.8125rem] text-fg-2">
                  <span className="inline-flex items-center gap-1.5">
                    <StatusDot variant={VISUAL[live!.state].variant} tone={VISUAL[live!.state].tone} />
                    {m.name}
                    {m.company ? <span className="text-fg-3">· {m.company}</span> : null}
                  </span>
                  {live!.state !== "printing" ? <span className="text-fg-3">· {PRINTER_STATE_LABELS[live!.state]}</span> : null}
                </p>
              </div>
              <div className="shrink-0 text-right text-[0.8125rem] tabular">
                {job?.remainingSec !== undefined ? <p className="text-fg">{formatDuration(job.remainingSec)}</p> : null}
                {end ? <p className="text-fg-3">Fin {end}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
      {others.length > 0 ? (
        <p className={cn("flex flex-wrap gap-x-4 gap-y-1.5 text-[0.8125rem] text-fg-3", working.length > 0 && "border-t border-line pt-3.5")}>
          {others.map(({ live, ...m }) => (
            <Link key={m.id} href={m.href} className="inline-flex items-center gap-1.5 hover:text-fg">
              <StatusDot variant={VISUAL[live?.state ?? "offline"].variant} tone={VISUAL[live?.state ?? "offline"].tone} />
              {m.name} · {PRINTER_STATE_LABELS[live?.state ?? "offline"].toLowerCase()}
            </Link>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/** Contador «X / Y» de máquinas trabajando (para KPIs). */
export function WorkingCount({ machineIds }: { machineIds?: string[] }) {
  const { machines } = useLiveMachines();
  const scope = machineIds ? machines.filter((m) => machineIds.includes(m.machineId)) : machines;
  return (
    <>
      {scope.filter((m) => WORKING_STATES.includes(m.state)).length} / {scope.length}
    </>
  );
}

function Metric({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[0.8125rem] text-fg-3 [&>svg]:size-3.5">
        {icon}
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-lg tabular">{value}</p>
      {sub ? <p className="text-[0.8125rem] text-fg-3 tabular">{sub}</p> : null}
    </div>
  );
}

/** Panel grande de la ficha: estado, pieza que se imprime, temperaturas, filamento y errores. */
export function MachineLivePanel({ machineId, timeZone, connectionLabel }: { machineId: string; timeZone: string; connectionLabel: string }) {
  const live = useLiveMachine(machineId);
  const { serverTime, online } = useLiveMachines();
  const state: PrinterState = live?.state ?? "offline";
  const t = live?.telemetry;
  const job = t?.job;
  const showJob = WORKING_STATES.includes(state) || state === "finished" || (state === "error" && job);
  const end = eta(serverTime, job?.remainingSec, timeZone);
  const temps = t?.temps;
  const safe = (url?: string) => (url && /^https?:\/\//i.test(url) ? url : undefined);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <LiveState state={state} className="text-base" />
          {live?.stateSince ? (
            <span className="text-[0.8125rem] text-fg-3">
              desde <RelativeTime value={live.stateSince} />
            </span>
          ) : null}
        </div>
        <span className="inline-flex items-center gap-2 text-[0.8125rem] text-fg-3">
          {!online ? <WifiOff className="size-3.5" aria-hidden="true" /> : live?.source === "live" && state !== "offline" ? <StatusDot variant="pulse" /> : null}
          {connectionLabel}
          {live?.source === "live" && live.updatedAt ? (
            <>
              {" · "}actualizado <RelativeTime value={live.updatedAt} />
            </>
          ) : null}
        </span>
      </div>

      <div className="p-5">
        {t?.errors?.length ? (
          <Alert tone="danger" title={state === "error" ? "La impresora está en error" : "Aviso de la impresora"} className="mb-5">
            <ul className="list-inside list-disc">
              {t.errors.map((e, i) => (
                <li key={i}>
                  {e.message}
                  {e.code ? <span className="text-fg-3"> ({e.code})</span> : null}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {showJob ? (
          <div className="flex flex-col gap-6 md:flex-row md:items-center">
            <div className="flex items-center gap-5">
              {safe(job?.thumbnailUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={safe(job?.thumbnailUrl)} alt="" className="size-24 shrink-0 rounded-md border border-line bg-elevated object-contain" />
              ) : null}
              <ProgressRing value={job?.progress ?? 0} size={112} stroke={8} label="Progreso de la impresión">
                <span className="text-xl">{Math.round(job?.progress ?? 0)}%</span>
              </ProgressRing>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] text-fg-3">{state === "finished" ? "Pieza terminada" : "Pieza en impresión"}</p>
              <p className="mt-0.5 break-words text-lg font-semibold">{job?.title ?? job?.fileName ?? "Impresión en curso"}</p>
              {job?.fileName && job.fileName !== job.title ? <p className="truncate font-mono text-[0.8125rem] text-fg-3">{job.fileName}</p> : null}
              {t?.stateDetail ? <p className="mt-1 text-sm text-fg-2">{t.stateDetail}</p> : null}
              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                <Metric icon={<Layers />} label="Capa" value={job?.layer !== undefined ? `${job.layer}${job.totalLayers ? ` / ${job.totalLayers}` : ""}` : "—"} />
                <Metric icon={<Timer />} label="Transcurrido" value={job?.elapsedSec !== undefined ? formatDuration(job.elapsedSec) : "—"} />
                <Metric icon={<Timer />} label="Restante" value={job?.remainingSec !== undefined ? formatDuration(job.remainingSec) : "—"} sub={end ? `Fin a las ${end}` : undefined} />
                <Metric icon={<CircleDot />} label="Material usado" value={job?.filamentUsedG !== undefined ? formatWeight(job.filamentUsedG) : job?.filamentUsedMm !== undefined ? `${(job.filamentUsedMm / 1000).toFixed(1)} m` : "—"} />
              </div>
            </div>
          </div>
        ) : state === "offline" ? (
          <div className="flex items-start gap-3 text-sm text-fg-2">
            <PowerOff className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden="true" />
            <p>
              No hay conexión con la máquina.{" "}
              {live?.updatedAt ? (
                <>
                  Última señal: {formatDateTime(live.updatedAt, timeZone)}.
                </>
              ) : (
                "Comprueba que está encendida y los datos de conexión en la pestaña Ajustes."
              )}
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-3 text-sm text-fg-2">
            <Power className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden="true" />
            <p>La máquina está en reposo y lista para imprimir.</p>
          </div>
        )}

        {temps || t?.speedPct !== undefined || t?.fanPct !== undefined ? (
          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-5">
            {temps?.nozzle ? <Metric icon={<Thermometer />} label="Boquilla" value={formatTemp(temps.nozzle.current)} sub={temps.nozzle.target ? `Objetivo ${formatTemp(temps.nozzle.target)}` : undefined} /> : null}
            {temps?.bed ? <Metric icon={<Thermometer />} label="Cama" value={formatTemp(temps.bed.current)} sub={temps.bed.target ? `Objetivo ${formatTemp(temps.bed.target)}` : undefined} /> : null}
            {temps?.chamber ? <Metric icon={<Thermometer />} label="Cámara" value={formatTemp(temps.chamber.current)} /> : null}
            {t?.speedPct !== undefined ? <Metric icon={<Gauge />} label="Velocidad" value={`${t.speedPct} %`} /> : null}
            {t?.fanPct !== undefined ? <Metric icon={<Fan />} label="Ventilador" value={`${t.fanPct} %`} /> : null}
          </div>
        ) : null}

        {t?.filament?.length ? (
          <div className="mt-6 border-t border-line pt-5">
            <p className="mb-3 text-[0.8125rem] text-fg-3">Material cargado en la máquina</p>
            <ul className="flex flex-wrap gap-2">
              {t.filament.map((f, i) => (
                <li key={i} className={cn("flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm", f.active ? "border-line-strong bg-elevated" : "border-line")}>
                  <span aria-hidden="true" className="size-4 shrink-0 rounded-xl border border-line-strong" style={{ background: f.color ?? "transparent" }} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{f.name ?? f.type ?? "Sin identificar"}</span>
                    <span className="block text-xs text-fg-3">
                      {f.slot}
                      {f.remainingPct !== undefined ? ` · queda ${f.remainingPct} %` : ""}
                      {f.active ? " · en uso" : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {safe(t?.cameraUrl) ? (
          <a href={safe(t?.cameraUrl)} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex h-9 items-center gap-2 rounded-md border border-control px-3 text-sm hover:bg-hover active:bg-active pointer-coarse:h-11">
            <Camera className="size-4" aria-hidden="true" /> Abrir cámara
          </a>
        ) : null}
      </div>
    </Card>
  );
}

const EVENT_ICON: Partial<Record<MachineEventType, typeof Play>> = {
  print_started: Play,
  print_paused: Pause,
  print_resumed: Play,
  print_finished: Printer,
  print_failed: AlertCircle,
  print_cancelled: Square,
  error: AlertCircle,
  offline: WifiOff,
  online: Power,
};

export interface TimelineEvent {
  id: string;
  type: MachineEventType;
  message: string;
  createdAt: string;
}

/** Línea de tiempo de eventos de la máquina; se refresca sola cada pocos segundos. */
export function EventsTimeline({ initial, url, timeZone }: { initial: TimelineEvent[]; url: string; timeZone: string }) {
  const [events, setEvents] = useState(initial);
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok || stopped) return;
        const data = (await res.json()) as { events: TimelineEvent[] };
        setEvents(data.events);
      } catch {
        /* se reintenta en el siguiente ciclo */
      }
    };
    const timer = setInterval(load, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [url]);

  if (events.length === 0) {
    return <p className="py-6 text-center text-sm text-fg-2">Aquí aparecerán los eventos de la máquina: inicios, pausas, fines de impresión, errores y cortes de conexión.</p>;
  }
  return (
    <ol className="flex flex-col">
      {events.map((e) => {
        const Icon = EVENT_ICON[e.type] ?? CircleDot;
        const bad = e.type === "print_failed" || e.type === "error";
        return (
          <li key={e.id} className="flex gap-3 border-b border-line py-3 last:border-b-0">
            <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-elevated", bad ? "text-danger" : "text-fg-2")}>
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-medium">{MACHINE_EVENT_LABELS[e.type]}</span>
                <span className="text-fg-2"> · {e.message}</span>
              </p>
              <p className="text-xs text-fg-3">
                <RelativeTime value={e.createdAt} /> · {formatDateTime(e.createdAt, timeZone)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
