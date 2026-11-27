import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { machineEvents, machineLive, machines, materials, printJobs } from "@/server/db/schema";
import { applyTelemetry, resolveJobClosure } from "@/server/printers/ingest";
import type { PrinterTelemetry } from "@/lib/telemetry";
import { freshDb, makeCompany } from "../../helpers/db";

const T0 = new Date("2026-11-25T08:00:00Z").getTime();
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

async function setup(unit: "g" | "ml" = "g") {
  const db = await getDb();
  const company = await makeCompany("Prokeys", { electricityMode: "fixed", kwhPrice: 0.2 });
  const [material] = await db
    .insert(materials)
    .values({ companyId: company.id, name: "PLA", materialType: "PLA", unit, stockQty: 1000, packSize: 1000, packCostCents: 2000 })
    .returning();
  const [machine] = await db
    .insert(machines)
    .values({ companyId: company.id, name: "P1S", powerPrintW: 120, connectionType: "simulator", loadedMaterialId: material.id })
    .returning();
  const send = (min: number, telemetry: PrinterTelemetry) => applyTelemetry(db, { machineId: machine.id, telemetry, at: at(min) });
  const jobs = () => db.select().from(printJobs).orderBy(printJobs.startedAt);
  const events = async () => (await db.select().from(machineEvents).orderBy(machineEvents.createdAt)).map((e) => e.type);
  const live = async () => (await db.select().from(machineLive).where(eq(machineLive.machineId, machine.id)))[0];
  return { db, company, machine, material, send, jobs, events, live };
}

const printing = (progress: number, extra: Partial<NonNullable<PrinterTelemetry["job"]>> = {}): PrinterTelemetry => ({
  state: "printing",
  job: { fileName: "teclas.3mf", title: "teclas", progress, ...extra },
});

beforeEach(async () => {
  await freshDb();
});

describe("ingesta de telemetría", () => {
  it("ciclo completo: abre una impresión, sigue el progreso y la cierra con energía y material", async () => {
    const { db, material, send, jobs, events, live } = await setup();
    await send(0, { state: "idle" });
    await send(1, { state: "preparing", job: { fileName: "teclas.3mf", title: "teclas", progress: 0 } });
    await send(2, printing(1));
    await send(30, printing(50));
    await send(61, printing(99, { elapsedSec: 3600, filamentUsedG: 42.5 }));
    expect((await live()).state).toBe("printing");
    expect((await jobs())[0]).toMatchObject({ status: "printing", source: "live", name: "teclas", progress: 99 });

    await send(62, { state: "finished", job: { fileName: "teclas.3mf", title: "teclas", progress: 100, elapsedSec: 3600, filamentUsedG: 42.5 } });
    await send(63, { state: "idle" });
    const all = await jobs();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: "completed", durationSec: 3600, progress: 100, materialUsed: 42.5, materialCostCents: 85 });
    expect(all[0].energyKwh).toBeCloseTo(0.12, 10); // 120 W × 1 h
    expect(all[0].energyCostCents).toBe(2);
    expect((await db.select().from(materials).where(eq(materials.id, material.id)))[0].stockQty).toBe(957.5);
    expect(await events()).toEqual(["online", "print_started", "print_finished"]);
    expect((await live()).currentJobId).toBeNull();
  });

  it("no duplica impresiones ni eventos aunque lleguen muchas telemetrías iguales", async () => {
    const { send, jobs, events } = await setup();
    for (let m = 0; m < 10; m++) await send(m, printing(10 + m));
    expect(await jobs()).toHaveLength(1);
    expect(await events()).toEqual(["online", "print_started"]);
  });

  it("pausa y reanuda", async () => {
    const { send, jobs, events } = await setup();
    await send(0, printing(10));
    await send(5, { ...printing(20), state: "paused", stateDetail: "Falta filamento" });
    expect((await jobs())[0].status).toBe("paused");
    await send(6, { ...printing(20), state: "paused" });
    await send(9, printing(21));
    expect((await jobs())[0].status).toBe("printing");
    expect(await events()).toEqual(["online", "print_started", "print_paused", "print_resumed"]);
  });

  it("un error durante la impresión la marca como fallida, sin duplicar el aviso", async () => {
    const { send, jobs, events } = await setup();
    await send(0, printing(40));
    await send(10, { state: "error", job: { fileName: "teclas.3mf", progress: 45 }, errors: [{ code: "E07", message: "Atasco de filamento" }] });
    await send(11, { state: "error", errors: [{ code: "E07", message: "Atasco de filamento" }] });
    const [job] = await jobs();
    expect(job).toMatchObject({ status: "failed", errorMessage: "Atasco de filamento", durationSec: 600 });
    expect(await events()).toEqual(["online", "print_started", "print_failed"]);
  });

  it("volver a reposo sin terminar = cancelada; con el progreso al 100 = completada", async () => {
    const a = await setup();
    await a.send(0, printing(30));
    await a.send(5, { state: "idle" });
    expect((await a.jobs())[0].status).toBe("cancelled");
    expect(await a.events()).toEqual(["online", "print_started", "print_cancelled"]);

    await freshDb();
    const b = await setup();
    await b.send(0, printing(30));
    await b.send(50, printing(99.8));
    await b.send(51, { state: "idle" });
    expect((await b.jobs())[0].status).toBe("completed");
  });

  it("un corte de conexión no cierra la impresión", async () => {
    const { send, jobs, events, live } = await setup();
    await send(0, printing(30));
    await send(5, { state: "offline" });
    expect((await jobs())[0].status).toBe("printing");
    expect((await live()).currentJobId).not.toBeNull();
    await send(20, printing(60));
    expect(await jobs()).toHaveLength(1);
    await send(40, { state: "finished", job: { fileName: "teclas.3mf", progress: 100 } });
    expect((await jobs())[0].status).toBe("completed");
    expect(await events()).toEqual(["online", "print_started", "offline", "online", "print_finished"]);
  });

  it("si vuelve de un corte ya en reposo, resuelve la impresión pendiente", async () => {
    const { send, jobs } = await setup();
    await send(0, printing(30));
    await send(5, { state: "offline" });
    await send(90, { state: "idle" });
    expect((await jobs())[0].status).toBe("cancelled");
  });

  it("detecta que empezó otro trabajo sin pasar por reposo", async () => {
    const { send, jobs } = await setup();
    await send(0, printing(10));
    await send(60, printing(100));
    await send(61, { state: "printing", job: { fileName: "figura.3mf", title: "figura", progress: 2 } });
    const all = await jobs();
    expect(all.map((j) => [j.name, j.status])).toEqual([
      ["teclas", "completed"],
      ["figura", "printing"],
    ]);
  });

  it("si empieza otra pieza sin pasar por reposo, la anterior se cierra con SUS datos y no con los de la nueva", async () => {
    const { db, material, send, jobs } = await setup();
    await send(0, printing(1, { elapsedSec: 30, filamentUsedG: 0.2 }));
    await send(60, printing(99, { elapsedSec: 3600, filamentUsedG: 42 }));
    // Cola de impresión: la siguiente bandeja arranca antes de que se vea «terminada».
    await send(61, { state: "printing", job: { fileName: "figura.3mf", title: "figura", progress: 1, elapsedSec: 20, filamentUsedG: 0.3 } });
    const all = await jobs();
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ name: "teclas", status: "completed", durationSec: 3600, materialUsed: 42 });
    expect(all[0].energyKwh).toBeCloseTo(0.12, 10);
    expect(all[1]).toMatchObject({ name: "figura", status: "printing", endedAt: null });
    expect((await db.select().from(materials).where(eq(materials.id, material.id)))[0].stockQty).toBe(958);
    expect((await db.select().from(machines))[0].totalPrintSeconds).toBe(3600);
  });

  it("una impresión que acaba durante un corte largo no cuenta el corte como tiempo de impresión", async () => {
    const { send, jobs } = await setup();
    await send(0, printing(1, { elapsedSec: 10 }));
    await send(57, printing(95, { elapsedSec: 3400, remainingSec: 180, filamentUsedG: 40 }));
    await send(58, { state: "offline" });
    // Diez horas después la conexión vuelve con la impresora en reposo.
    await send(58 + 600, { state: "idle" });
    const [job] = await jobs();
    expect(job.status).toBe("completed"); // le quedaban 3 min: tuvo tiempo de sobra
    expect(job.durationSec).toBe(3580); // 3400 s + los 180 s que faltaban, no 10 h
    expect(job.endedAt?.toISOString()).toBe(at(60));
    expect(job.materialUsed).toBe(42.1); // 40 g al 95 % → extrapolado al 100 %
    expect(job.energyKwh).toBeCloseTo((120 * 3580) / 3_600_000, 6);
  });

  it("reimprimir el mismo archivo tras un corte abre una impresión nueva", async () => {
    const { send, jobs, events } = await setup();
    await send(0, printing(1, { elapsedSec: 10 }));
    await send(50, printing(90, { elapsedSec: 3000, remainingSec: 330, filamentUsedG: 38 }));
    await send(51, { state: "offline" });
    // Termina, se lanza otra vez la misma bandeja y la conexión vuelve al 10 % de la segunda.
    await send(120, printing(10, { elapsedSec: 400, remainingSec: 3000, filamentUsedG: 4 }));
    const all = await jobs();
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ status: "completed", durationSec: 3330, materialUsed: 42.2 });
    expect(all[1]).toMatchObject({ status: "printing", progress: 10 });
    expect(await events()).toEqual(["online", "print_started", "offline", "online", "print_finished", "print_started"]);
  });

  it("el nombre del archivo que llega tarde no parte la impresión en dos", async () => {
    const { send, jobs } = await setup();
    await send(0, { state: "preparing" });
    await send(1, { state: "printing", job: { fileName: "teclas.3mf", title: "teclas", progress: 2 } });
    await send(2, printing(4));
    const all = await jobs();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ name: "teclas", fileName: "teclas.3mf" });
  });

  it("resolveJobClosure: reglas de cierre", () => {
    const start = new Date(T0);
    const min = (m: number) => new Date(T0 + m * 60_000);
    // Seguimiento continuo: manda lo que diga la impresora.
    expect(resolveJobClosure({ startedAt: start, at: min(60), jobProgress: 100, last: { at: min(59.8), facts: { elapsedSec: 3500 } }, current: { elapsedSec: 3550 }, how: "completed" })).toEqual({ status: "completed", endedAt: min(60), durationSec: 3550, estimated: false, materialFactor: 1 });
    // Sin tiempo de impresión fiable: tiempo de reloj.
    expect(resolveJobClosure({ startedAt: start, at: min(10), jobProgress: 30, last: null, current: null, how: "auto" })).toMatchObject({ status: "cancelled", durationSec: 600 });
    // Corte a mitad con mucho por delante y vuelve enseguida en reposo: cancelada, sin inventar horas.
    const cancelled = resolveJobClosure({ startedAt: start, at: min(40), jobProgress: 20, last: { at: min(20), facts: { progress: 20, elapsedSec: 1200, remainingSec: 4800 } }, current: null, how: "auto" });
    expect(cancelled).toMatchObject({ status: "cancelled", estimated: true, durationSec: 2400, materialFactor: 1 });
    // Sin «tiempo restante»: se deduce del ritmo (30 min para el 50 % → le quedaban otros 30).
    expect(resolveJobClosure({ startedAt: start, at: min(600), jobProgress: 50, last: { at: min(30), facts: { progress: 50, elapsedSec: 1800 } }, current: null, how: "auto" })).toMatchObject({ status: "cancelled", durationSec: 3600 });
    // Sin ningún dato: como mucho media hora del corte, nunca las diez horas.
    expect(resolveJobClosure({ startedAt: start, at: min(600), jobProgress: 0, last: { at: min(0), facts: {} }, current: null, how: "completed" })).toMatchObject({ durationSec: 1800, estimated: true });
    // Un error conocido se respeta aunque haya habido corte.
    expect(resolveJobClosure({ startedAt: start, at: min(600), jobProgress: 50, last: { at: min(30), facts: { progress: 50, elapsedSec: 1800, remainingSec: 1800 } }, current: null, how: "failed" }).status).toBe("failed");
  });

  it("convierte milímetros de filamento a gramos y no inventa consumo de resina", async () => {
    const a = await setup("g");
    await a.send(0, printing(10));
    await a.send(60, { state: "finished", job: { fileName: "teclas.3mf", progress: 100, filamentUsedMm: 10_000 } });
    // 10 m de PLA de 1,75 mm ≈ 29,8 g
    expect((await a.jobs())[0].materialUsed).toBeCloseTo(29.8, 1);

    await freshDb();
    const b = await setup("ml");
    await b.send(0, printing(10));
    await b.send(60, { state: "finished", job: { fileName: "teclas.3mf", progress: 100, filamentUsedG: 50 } });
    expect((await b.jobs())[0].materialUsed).toBe(0);
  });

  it("ignora telemetría atrasada, basura numérica y máquinas que no existen", async () => {
    const { db, send, jobs, live } = await setup();
    await send(10, printing(50));
    await send(5, { state: "idle" }); // llegó tarde
    expect((await live()).state).toBe("printing");
    await send(11, { state: "printing", job: { fileName: "teclas.3mf", progress: Number.NaN, elapsedSec: -5, layer: Number.POSITIVE_INFINITY } } as PrinterTelemetry);
    const l = await live();
    expect(l.telemetry?.job?.progress).toBeUndefined();
    expect(l.telemetry?.job?.elapsedSec).toBe(0);
    expect(await jobs()).toHaveLength(1);
    await expect(applyTelemetry(db, { machineId: crypto.randomUUID(), telemetry: { state: "idle" }, at: at(0) })).resolves.toBeUndefined();
    await send(12, { state: "bogus" } as unknown as PrinterTelemetry); // estado desconocido → sin conexión
    expect((await live()).state).toBe("offline");
  });

  it("procesa en orden las llamadas concurrentes de una misma máquina", async () => {
    const { send, jobs, events } = await setup();
    await Promise.all([send(0, printing(5)), send(1, printing(6)), send(2, printing(7)), send(3, { state: "finished", job: { fileName: "teclas.3mf", progress: 100 } })]);
    expect(await jobs()).toHaveLength(1);
    expect((await jobs())[0].status).toBe("completed");
    expect(await events()).toEqual(["online", "print_started", "print_finished"]);
  });
});
