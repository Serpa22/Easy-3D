/** Lecturas de energía: consumo estimado (impresiones) y facturas reales. */
import "server-only";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { energyBills, machines, printJobs } from "@/server/db/schema";
import { sum } from "@/server/db/sql";
import { energyKwh, splitSecondsByPeriod } from "@/lib/energy";
import type { TariffPeriod } from "@/lib/domain";

/** Consumo y coste estimados del mes por máquina, reparto por periodos y estimación en reposo. */
export async function getEnergyMonth(db: DbOrTx, companyId: string, from: Date, to: Date, timeZone: string, now: Date) {
  const [perMachine, jobs, machineRows] = await Promise.all([
    db
      .select({ machineId: printJobs.machineId, name: machines.name, kwh: sum(printJobs.energyKwh), costCents: sum(printJobs.energyCostCents), seconds: sum(printJobs.durationSec) })
      .from(printJobs)
      .leftJoin(machines, eq(machines.id, printJobs.machineId))
      .where(and(eq(printJobs.companyId, companyId), gte(printJobs.startedAt, from), lt(printJobs.startedAt, to)))
      .groupBy(printJobs.machineId, machines.name),
    db
      .select({ startedAt: printJobs.startedAt, durationSec: printJobs.durationSec, kwh: printJobs.energyKwh })
      .from(printJobs)
      .where(and(eq(printJobs.companyId, companyId), gte(printJobs.startedAt, from), lt(printJobs.startedAt, to), sql`${printJobs.durationSec} > 0`))
      .limit(5000),
    db.select({ id: machines.id, powerIdleW: machines.powerIdleW, createdAt: machines.createdAt }).from(machines).where(and(eq(machines.companyId, companyId), eq(machines.status, "active"))),
  ]);

  // Reparto de los kWh de cada impresión entre periodos, en proporción al tiempo.
  const byPeriod: Record<TariffPeriod, number> = { peak: 0, flat: 0, valley: 0 };
  for (const job of jobs) {
    const split = splitSecondsByPeriod(job.startedAt, job.durationSec, timeZone);
    for (const period of ["peak", "flat", "valley"] as const) byPeriod[period] += job.kwh * (split[period] / job.durationSec);
  }

  // Reposo: potencia en reposo × (horas transcurridas del mes − horas imprimiendo).
  const end = Math.min(to.getTime(), now.getTime());
  const secondsByMachine = new Map(perMachine.map((m) => [m.machineId, m.seconds]));
  let idleKwh = 0;
  for (const m of machineRows) {
    const start = Math.max(from.getTime(), m.createdAt.getTime());
    const elapsed = Math.max(0, (end - start) / 1000);
    idleKwh += energyKwh(m.powerIdleW, Math.max(0, elapsed - (secondsByMachine.get(m.id) ?? 0)));
  }

  const kwh = perMachine.reduce((a, m) => a + m.kwh, 0);
  const costCents = perMachine.reduce((a, m) => a + m.costCents, 0);
  const seconds = perMachine.reduce((a, m) => a + m.seconds, 0);
  return { perMachine: perMachine.sort((a, b) => b.kwh - a.kwh), byPeriod, idleKwh, kwh, costCents, seconds };
}

/** kWh estimados por mes (impresión) y kWh facturados por mes (según fin del periodo). */
export async function getEnergyByMonth(db: DbOrTx, companyId: string, months: string[], timeZone: string, from: Date) {
  const month = sql<string>`to_char(${printJobs.startedAt} at time zone ${timeZone}, 'YYYY-MM')`;
  const billMonth = sql<string>`to_char(${energyBills.periodEnd}, 'YYYY-MM')`;
  const [estimated, billed] = await Promise.all([
    db.select({ month, kwh: sum(printJobs.energyKwh) }).from(printJobs).where(and(eq(printJobs.companyId, companyId), gte(printJobs.startedAt, from))).groupBy(sql`1`),
    db
      .select({ month: billMonth, kwh: sum(energyBills.kwh), cents: sum(energyBills.amountCents) })
      .from(energyBills)
      .where(and(eq(energyBills.companyId, companyId), gte(energyBills.periodEnd, `${months[0]}-01`)))
      .groupBy(billMonth),
  ]);
  const e = new Map(estimated.map((r) => [r.month, r.kwh]));
  const b = new Map(billed.map((r) => [r.month, r]));
  return months.map((m) => ({ month: m, estimatedKwh: e.get(m) ?? 0, billedKwh: b.get(m)?.kwh ?? null, billedCents: b.get(m)?.cents ?? null }));
}

export async function listEnergyBills(db: DbOrTx, companyId: string) {
  return db.select().from(energyBills).where(eq(energyBills.companyId, companyId)).orderBy(desc(energyBills.periodEnd)).limit(60);
}
