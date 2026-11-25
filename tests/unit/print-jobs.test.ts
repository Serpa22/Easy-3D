import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { machines, materialMovements, materials, printJobs, products } from "@/server/db/schema";
import { deletePrintJob, finishPrintJob, startPrintJob } from "@/server/domain/print-jobs";
import { freshDb, makeCompany } from "../helpers/db";

async function setup() {
  const db = await getDb();
  const company = await makeCompany("Teclas", { electricityMode: "fixed", kwhPrice: 0.2 });
  const [material] = await db
    .insert(materials)
    .values({ companyId: company.id, name: "PLA negro", unit: "g", stockQty: 1000, packSize: 1000, packCostCents: 2000 })
    .returning();
  const [machine] = await db
    .insert(machines)
    .values({ companyId: company.id, name: "P1S #1", powerPrintW: 150, loadedMaterialId: material.id })
    .returning();
  const [product] = await db
    .insert(products)
    .values({ companyId: company.id, name: "Set de teclas", priceCents: 2500, stockQty: 3 })
    .returning();
  return { db, company, material, machine, product };
}

beforeEach(async () => {
  await freshDb();
});

describe("impresiones", () => {
  it("al abrir usa el material cargado en la máquina", async () => {
    const { db, company, machine, material } = await setup();
    const job = await startPrintJob(db, {
      companyId: company.id,
      machineId: machine.id,
      name: "teclas_v3.3mf",
      source: "live",
      startedAt: new Date("2026-11-25T08:00:00Z"),
    });
    expect(job.status).toBe("printing");
    expect(job.materialId).toBe(material.id);
  });

  it("al terminar calcula energía, descuenta material y suma horas y piezas", async () => {
    const { db, company, machine, material, product } = await setup();
    const job = await startPrintJob(db, {
      companyId: company.id,
      machineId: machine.id,
      name: "teclas_v3.3mf",
      source: "live",
      startedAt: new Date("2026-11-25T08:00:00Z"),
      productId: product.id,
    });
    const done = await db.transaction((tx) =>
      finishPrintJob(tx, {
        companyId: company.id,
        jobId: job.id,
        status: "completed",
        endedAt: new Date("2026-11-25T10:00:00Z"),
        materialUsed: 80,
        piecesProduced: 12,
      }),
    );
    expect(done.status).toBe("completed");
    expect(done.durationSec).toBe(7200);
    expect(done.progress).toBe(100);
    expect(done.energyKwh).toBeCloseTo(0.3, 10); // 150 W × 2 h
    expect(done.energyCostCents).toBe(6); // 0,3 kWh × 0,20 €
    expect(done.materialCostCents).toBe(160); // 80 g de una bobina de 20 €/kg

    const [m] = await db.select().from(materials).where(eq(materials.id, material.id));
    expect(m.stockQty).toBe(920);
    const [mc] = await db.select().from(machines).where(eq(machines.id, machine.id));
    expect(mc.totalPrintSeconds).toBe(7200);
    const [p] = await db.select().from(products).where(eq(products.id, product.id));
    expect(p.stockQty).toBe(15);
    expect(await db.select().from(materialMovements)).toHaveLength(1);
  });

  it("es idempotente: corregir una impresión cerrada no duplica efectos", async () => {
    const { db, company, machine, material, product } = await setup();
    const job = await startPrintJob(db, {
      companyId: company.id,
      machineId: machine.id,
      name: "teclas",
      source: "manual",
      startedAt: new Date("2026-11-25T08:00:00Z"),
      productId: product.id,
    });
    const base = { companyId: company.id, jobId: job.id, status: "completed" as const, endedAt: new Date("2026-11-25T10:00:00Z") };
    await finishPrintJob(db, { ...base, materialUsed: 80, piecesProduced: 12 });
    await finishPrintJob(db, { ...base, materialUsed: 100, piecesProduced: 10, durationSec: 3600 });

    const [m] = await db.select().from(materials).where(eq(materials.id, material.id));
    expect(m.stockQty).toBe(900);
    const [mc] = await db.select().from(machines).where(eq(machines.id, machine.id));
    expect(mc.totalPrintSeconds).toBe(3600);
    const [p] = await db.select().from(products).where(eq(products.id, product.id));
    expect(p.stockQty).toBe(13);
    expect(await db.select().from(materialMovements)).toHaveLength(1);
  });

  it("una impresión fallida gasta material y energía pero no produce piezas", async () => {
    const { db, company, machine, material, product } = await setup();
    const job = await startPrintJob(db, {
      companyId: company.id,
      machineId: machine.id,
      name: "teclas",
      source: "live",
      startedAt: new Date("2026-11-25T08:00:00Z"),
      productId: product.id,
    });
    const failed = await finishPrintJob(db, {
      companyId: company.id,
      jobId: job.id,
      status: "failed",
      endedAt: new Date("2026-11-25T08:30:00Z"),
      materialUsed: 20,
      errorMessage: "Atasco de filamento",
    });
    expect(failed.status).toBe("failed");
    expect(failed.errorMessage).toBe("Atasco de filamento");
    expect(failed.progress).toBe(0);
    const [m] = await db.select().from(materials).where(eq(materials.id, material.id));
    expect(m.stockQty).toBe(980);
    const [p] = await db.select().from(products).where(eq(products.id, product.id));
    expect(p.stockQty).toBe(3);
  });

  it("borrar una impresión devuelve material, horas y piezas", async () => {
    const { db, company, machine, material, product } = await setup();
    const job = await startPrintJob(db, {
      companyId: company.id,
      machineId: machine.id,
      name: "teclas",
      source: "manual",
      startedAt: new Date("2026-11-25T08:00:00Z"),
      productId: product.id,
    });
    await finishPrintJob(db, {
      companyId: company.id,
      jobId: job.id,
      status: "completed",
      endedAt: new Date("2026-11-25T10:00:00Z"),
      materialUsed: 80,
      piecesProduced: 12,
    });
    await db.transaction((tx) => deletePrintJob(tx, company.id, job.id));
    const [m] = await db.select().from(materials).where(eq(materials.id, material.id));
    expect(m.stockQty).toBe(1000);
    const [mc] = await db.select().from(machines).where(eq(machines.id, machine.id));
    expect(mc.totalPrintSeconds).toBe(0);
    const [p] = await db.select().from(products).where(eq(products.id, product.id));
    expect(p.stockQty).toBe(3);
    expect(await db.select().from(printJobs)).toHaveLength(0);
    expect(await db.select().from(materialMovements)).toHaveLength(0);
  });

  it("no deja operar sobre impresiones de otra empresa", async () => {
    const { db, company, machine } = await setup();
    const other = await makeCompany("Figuras");
    const job = await startPrintJob(db, {
      companyId: company.id,
      machineId: machine.id,
      name: "teclas",
      source: "manual",
      startedAt: new Date("2026-11-25T08:00:00Z"),
    });
    await expect(
      finishPrintJob(db, { companyId: other.id, jobId: job.id, status: "completed", endedAt: new Date() }),
    ).rejects.toThrow("La impresión no existe");
    await expect(deletePrintJob(db, other.id, job.id)).rejects.toThrow("La impresión no existe");
    await expect(
      startPrintJob(db, { companyId: other.id, machineId: machine.id, name: "x", source: "manual", startedAt: new Date() }),
    ).rejects.toThrow("La máquina no existe");
  });
});
