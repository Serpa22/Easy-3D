import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { machineEvents, machineLive, machines, materials, printJobs } from "@/server/db/schema";
import { applyTelemetry } from "@/server/printers/ingest";
import type { PrinterTelemetry } from "@/lib/telemetry";
import { freshDb, makeCompany } from "../../helpers/db";

const T0 = new Date("2026-11-25T08:00:00Z").getTime();
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

async function setup(unit: "g" | "ml" = "g") {
  const db = await getDb();
  const company = await makeCompany("Teclas", { electricityMode: "fixed", kwhPrice: 0.2 });
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
