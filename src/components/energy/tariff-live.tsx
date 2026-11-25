"use client";

import { useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/display";
import { Field, Input, NumberInput, Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { localHourAndWeekday, parseLocalDateTime, toLocalDateTimeInput } from "@/lib/dates";
import { TARIFF_PERIOD_LABELS, type TariffPeriod } from "@/lib/domain";
import { energyCost, priceForPeriod, tariffPeriodAt, type ElectricityTariff } from "@/lib/energy";
import { formatKwh, formatMoney, formatNumber, formatTime } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { parseDecimal } from "@/lib/validation";

const HEIGHT: Record<TariffPeriod, string> = { valley: "h-3", flat: "h-6", peak: "h-9" };
const FILL: Record<TariffPeriod, string> = { valley: "bg-fg-3", flat: "bg-fg-2", peak: "bg-fg" };

/** Periodo actual y franja de 24 h de hoy (altura + etiqueta: no depende del color). */
export function TariffToday({ tariff, timeZone }: { tariff: ElectricityTariff; timeZone: string }) {
  const nowMs = useNow();
  if (!nowMs) return <div className="h-24" aria-hidden="true" />;
  const now = new Date(nowMs);
  const local = localHourAndWeekday(now, timeZone);
  // Periodo de cada hora de hoy: se evalúa al comienzo de cada hora local.
  const startOfDay = new Date(now.getTime() - (local.hour * 3600 + now.getMinutes() * 60 + now.getSeconds()) * 1000);
  const hours = Array.from({ length: 24 }, (_, h) => tariffPeriodAt(new Date(startOfDay.getTime() + h * 3600_000 + 60_000), timeZone));
  const current = tariffPeriodAt(now, timeZone);
  return (
    <div>
      <p className="text-sm text-fg-2">
        Ahora ({formatTime(now, timeZone)}): periodo <span className="font-semibold text-fg">{TARIFF_PERIOD_LABELS[current].toLowerCase()}</span> ·{" "}
        <span className="font-mono text-fg tabular">{formatNumber(priceForPeriod(tariff, current), 4)} €/kWh</span>
      </p>
      <div className="mt-4 flex h-9 items-end gap-0.5" role="img" aria-label={`Periodos de hoy: ${hours.map((p, h) => `${h} h ${TARIFF_PERIOD_LABELS[p]}`).join(", ")}`}>
        {hours.map((p, h) => (
          <div key={h} className={cn("flex-1 rounded-[2px]", HEIGHT[p], FILL[p], h === local.hour && "outline outline-2 outline-offset-1 outline-ring")} title={`${h}:00 · ${TARIFF_PERIOD_LABELS[p]}`} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[0.6875rem] text-fg-3 tabular">
        <span>0 h</span>
        <span>6 h</span>
        <span>12 h</span>
        <span>18 h</span>
        <span>24 h</span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[0.8125rem] text-fg-2">
        {(["valley", "flat", "peak"] as const).map((p) => (
          <li key={p} className="inline-flex items-center gap-2">
            <span aria-hidden="true" className={cn("w-2.5 rounded-[2px]", p === "valley" ? "h-1.5" : p === "flat" ? "h-2.5" : "h-3.5", FILL[p])} />
            {TARIFF_PERIOD_LABELS[p]} · <span className="font-mono tabular">{formatNumber(priceForPeriod(tariff, p), 4)} €</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** «¿Cuánto cuesta imprimir N horas en la máquina X empezando a las HH:MM?» */
export function EnergySimulator({ tariff, timeZone, machines }: { tariff: ElectricityTariff; timeZone: string; machines: Array<{ id: string; name: string; powerPrintW: number }> }) {
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const [hours, setHours] = useState("4");
  // Hasta que el usuario elige otra hora, el inicio es «ahora».
  const nowMs = useNow();
  const [chosenStart, setStart] = useState<string | null>(null);
  const start = chosenStart ?? (nowMs ? toLocalDateTimeInput(new Date(nowMs), timeZone) : "");
  const machine = machines.find((m) => m.id === machineId);
  const result = useMemo(() => {
    const startDate = parseLocalDateTime(start, timeZone);
    const durationSec = Math.max(0, (parseDecimal(hours) ?? 0) * 3600);
    if (!machine || !startDate || durationSec === 0) return null;
    const at = (date: Date) => energyCost(tariff, { start: date, durationSec, watts: machine.powerPrintW, timeZone });
    const chosen = at(startDate);
    let best = { cost: chosen, date: startDate };
    if (tariff.electricityMode === "tou") {
      for (let h = 1; h <= 24; h++) {
        const date = new Date(Math.floor(startDate.getTime() / 3600_000) * 3600_000 + h * 3600_000);
        const c = at(date);
        if (c.costCents < best.cost.costCents) best = { cost: c, date };
      }
    }
    return { chosen, best };
  }, [machine, hours, start, tariff, timeZone]);

  return (
    <Card>
      <CardHeader title="Simulador" description="Cuánto cuesta de luz una impresión según cuándo la lances." />
      <CardBody className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Máquina">
            <Select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {Math.round(m.powerPrintW)} W
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Duración">
            <NumberInput unit="h" value={hours} onChange={(e) => setHours(e.target.value)} />
          </Field>
          <Field label="Empieza">
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="font-mono tabular" />
          </Field>
        </div>
        {machines.length === 0 ? (
          <p className="text-sm text-fg-2">Añade una máquina para usar el simulador.</p>
        ) : result ? (
          <div className="rounded-md border border-line bg-bg p-4 text-sm">
            <p className="text-fg-2">
              Consumo <span className="font-mono text-fg tabular">{formatKwh(result.chosen.kwh)}</span> · coste{" "}
              <span className="font-mono text-lg font-medium text-fg tabular">{formatMoney(result.chosen.costCents)}</span>
            </p>
            {tariff.electricityMode === "tou" ? (
              result.best.cost.costCents < result.chosen.costCents ? (
                <p className="mt-1.5 text-fg-2">
                  Si la lanzas a las <span className="font-medium text-fg">{formatTime(result.best.date, timeZone)}</span> costaría{" "}
                  <span className="font-mono text-fg tabular">{formatMoney(result.best.cost.costCents)}</span> (ahorras {formatMoney(result.chosen.costCents - result.best.cost.costCents)}).
                </p>
              ) : (
                <p className="mt-1.5 text-fg-2">Es la hora más barata de las próximas 24 h para esta impresión.</p>
              )
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
