import { describe, expect, it } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/server/db";
import { companies, machines, materials, orders, printJobs, products, shipments, transactions } from "@/server/db/schema";
import { count, sum } from "@/server/db/sql";
import { DEMO_MARKER, removeDemoData, seedDemoData } from "@/server/demo/seed";
import { createCompany } from "@/server/domain/companies";
import { todayISO } from "@/lib/dates";
import { freshDb } from "../../helpers/db";

async function snapshot() {
  const db = await getDb();
  const [[o], [t], [j], [s], [income], [paid]] = await Promise.all([
    db.select({ n: count() }).from(orders),
    db.select({ n: count() }).from(transactions),
    db.select({ n: count() }).from(printJobs),
    db.select({ n: count() }).from(shipments),
    db.select({ v: sum(transactions.amountCents) }).from(transactions).where(eq(transactions.sourceType, "order")),
    db.select({ v: sum(orders.totalCents) }).from(orders).where(eq(orders.paymentStatus, "paid")),
  ]);
  return { orders: o.n, transactions: t.n, jobs: j.n, shipments: s.n, orderIncome: income.v, paidTotal: paid.v };
}

describe("datos de demostración", () => {
  it("crea dos empresas coherentes, es idempotente y determinista", async () => {
    await freshDb();
    const started = Date.now();
    await seedDemoData();
    const elapsed = Date.now() - started;
    const db = await getDb();
    const first = await snapshot();

    expect((await db.select().from(companies)).map((c) => c.slug).sort()).toEqual(["figuras", "teclas"]);
    expect(first.orders).toBeGreaterThan(120);
    expect(first.jobs).toBeGreaterThan(150);
    expect(first.shipments).toBeGreaterThan(80);
    // El libro cuadra con los pedidos cobrados.
    expect(first.orderIncome).toBe(first.paidTotal);
    // Sin existencias negativas ni fechas futuras.
    expect((await db.select().from(materials)).every((m) => m.stockQty >= 0)).toBe(true);
    expect((await db.select().from(products)).every((p) => p.stockQty >= 0)).toBe(true);
    const today = todayISO();
    expect((await db.select().from(transactions)).every((t) => t.date <= today && t.amountCents > 0)).toBe(true);
    expect((await db.select().from(orders)).every((o) => o.orderDate <= today)).toBe(true);
    // Nada cruza de empresa: las impresiones usan máquinas de su empresa.
    const cross = await db
      .select({ n: count() })
      .from(printJobs)
      .innerJoin(machines, eq(machines.id, printJobs.machineId))
      .where(ne(machines.companyId, printJobs.companyId));
    expect(cross[0].n).toBe(0);
    // Hay avisos reales que enseñar: material bajo mínimo y pedidos abiertos.
    expect((await db.select().from(materials)).some((m) => m.stockQty < m.lowStockThreshold)).toBe(true);
    expect((await db.select({ n: count() }).from(orders).where(eq(orders.status, "pending")))[0].n).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(90_000);

    // Idempotente.
    await seedDemoData();
    expect(await snapshot()).toEqual(first);

    // Determinista: otra BD limpia produce lo mismo.
    await freshDb();
    await seedDemoData();
    expect(await snapshot()).toEqual(first);
  }, 240_000);

  it("nunca adopta ni borra una empresa real, aunque se llame igual, esté vacía o copie la descripción", async () => {
    await freshDb();
    const db = await getDb();
    // Empresa real «Figuras» con datos, y empresa real «Teclas» recién creada (vacía),
    // a la que además alguien le ha copiado la descripción de las de ejemplo.
    const figuras = await createCompany(db, { name: "Figuras" });
    await db.insert(machines).values({ companyId: figuras.id, name: "Mi impresora" });
    const teclas = await createCompany(db, { name: "Teclas", description: DEMO_MARKER });

    await seedDemoData();
    const all = await db.select().from(companies);
    expect(all.map((c) => [c.slug, c.demoKey]).sort()).toEqual([
      ["figuras", null],
      ["figuras-ejemplo", "figuras"],
      ["teclas", null],
      ["teclas-ejemplo", "teclas"],
    ]);
    // Las reales siguen intactas: ningún pedido de ejemplo se ha mezclado en ellas.
    expect(await db.select().from(orders).where(eq(orders.companyId, teclas.id))).toHaveLength(0);
    expect(await db.select().from(orders).where(eq(orders.companyId, figuras.id))).toHaveLength(0);

    // Volver a generar no duplica las de ejemplo.
    await seedDemoData();
    expect(await db.select().from(companies)).toHaveLength(4);

    expect(await removeDemoData()).toBe(2);
    const left = await db.select().from(companies);
    expect(left.map((c) => c.slug).sort()).toEqual(["figuras", "teclas"]);
    expect((await db.select().from(machines).where(and(eq(machines.companyId, figuras.id)))).length).toBe(1);
  }, 240_000);
});
