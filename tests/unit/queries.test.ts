/**
 * Prueba de humo: todas las lecturas que usan las páginas se ejecutan sin error
 * sobre los datos de demostración. Su valor está sobre todo en `npm run test:pg`:
 * PostgreSQL real es más estricto que PGlite con los parámetros (fechas dentro de
 * sql``, GROUP BY con parámetros…) y aquí se detecta antes de desplegar.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { addDays, lastMonths, monthOf, monthRange, startOfDayInZone, todayISO } from "@/lib/dates";
import { getDb, type Db } from "@/server/db";
import { companies, customers, machines, materials, orders, products, type Company } from "@/server/db/schema";
import { seedDemoData } from "@/server/demo/seed";
import { getCompanyOverview, getGroupOverview } from "@/server/queries/dashboard";
import { getEnergyByMonth, getEnergyMonth, listEnergyBills } from "@/server/queries/energy";
import { getCategoryBreakdown, getMonthlyTotals, getPeriodSummary, listTransactions } from "@/server/queries/finance";
import { getYearReport } from "@/server/queries/finance-reports";
import { getLiveMachines, getLiveSnapshot } from "@/server/queries/live";
import { getMachine, getMachineStats, hasMachinePurchaseExpense, listMachineEvents, listMachineJobs, listMachineOptions, listMachines, listMaintenance, listMaterialOptions } from "@/server/queries/machines";
import { getMaterial, getMaterialKpis, listMaterials } from "@/server/queries/materials";
import { getCustomer, getOrder, getOrderKpis, listCustomerOptions, listCustomers, listOrderOptions, listOrders, listProductOptions } from "@/server/queries/orders";
import { getDailyPrints, getPrintKpis, listPrintJobs } from "@/server/queries/prints";
import { getProduct, listProducts } from "@/server/queries/products";
import { getShipmentKpis, listReadyWithoutShipment, listShipments } from "@/server/queries/shipments";
import { freshDb } from "../helpers/db";

const TZ = "Europe/Madrid";
let db: Db;
let company: Company;
const today = todayISO(TZ);
const month = monthOf(today);
const range = monthRange(month);
const months = lastMonths(12, month);
const from = startOfDayInZone(range.from, TZ);
const to = startOfDayInZone(addDays(range.to, 1), TZ);

beforeAll(async () => {
  await freshDb();
  await seedDemoData();
  db = await getDb();
  [company] = await db.select().from(companies).where(eq(companies.slug, "prokeys"));
});

describe("lecturas de las páginas", () => {
  it("resumen de empresa y vista de grupo", async () => {
    const overview = await getCompanyOverview(db, company.id, company.slug, today);
    expect(overview).toBeTruthy();
    const all = await db.select({ id: companies.id }).from(companies);
    const group = await getGroupOverview(db, all.map((c) => c.id), month, months);
    expect(group.size).toBe(2);
  });

  it("finanzas e informes", async () => {
    const list = await listTransactions(db, company.id, { from: range.from, to: range.to });
    expect(list.total).toBeGreaterThan(0);
    await getPeriodSummary(db, company.id, range);
    expect(await getMonthlyTotals(db, company.id, months)).toHaveLength(12);
    await getCategoryBreakdown(db, company.id, { ...range, type: "expense" });
    await getYearReport(db, company.id, Number(today.slice(0, 4)));
  });

  it("pedidos, clientes y envíos", async () => {
    const list = await listOrders(db, company.id, {});
    expect(list.total).toBeGreaterThan(0);
    const kpis = await getOrderKpis(db, company.id, range);
    expect(kpis.monthSalesCents).toBeGreaterThanOrEqual(0);
    const [order] = await db.select({ id: orders.id }).from(orders).where(eq(orders.companyId, company.id)).limit(1);
    expect(await getOrder(db, company.id, order.id)).toBeTruthy();
    await listProductOptions(db, company.id);
    await listCustomerOptions(db, company.id);
    await listOrderOptions(db, company.id);
    for (const sort of ["gasto", "reciente", "nombre"] as const) await listCustomers(db, company.id, { sort });
    const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.companyId, company.id)).limit(1);
    expect(await getCustomer(db, company.id, customer.id)).toBeTruthy();

    await listShipments(db, company.id, {});
    const ship = await getShipmentKpis(db, company.id, range.from, range.to, addDays(today, -90));
    expect(ship.deliveredCount).toBeGreaterThanOrEqual(0);
    await listReadyWithoutShipment(db, company.id);
  });

  it("máquinas, en directo e impresiones", async () => {
    const list = await listMachines(db, company.id);
    expect(list.length).toBeGreaterThan(0);
    const machine = list[0];
    expect(await getMachine(db, company.id, machine.id)).toBeTruthy();
    const stats = await getMachineStats(db, company.id, machine.id, from);
    expect(stats.completed).toBeGreaterThan(0);
    await listMachineEvents(db, company.id, machine.id);
    await listMaintenance(db, company.id, machine.id);
    await listMachineJobs(db, company.id, machine.id);
    await listMaterialOptions(db, company.id);
    await listMachineOptions(db, company.id);
    await hasMachinePurchaseExpense(db, company.id, machine.id);
    await getLiveMachines(db, { companyId: company.id });
    await getLiveSnapshot(db, { companyId: company.id });

    // Mes anterior: seguro que tiene impresiones cerradas.
    const prev = monthRange(months[months.length - 2]);
    const pFrom = startOfDayInZone(prev.from, TZ);
    const pTo = startOfDayInZone(addDays(prev.to, 1), TZ);
    const jobs = await listPrintJobs(db, company.id, { from: pFrom, to: pTo });
    expect(jobs.total).toBeGreaterThan(0);
    const kpis = await getPrintKpis(db, company.id, pFrom, pTo);
    expect(kpis.completed).toBeGreaterThan(0);
    expect(kpis.seconds).toBeGreaterThan(0);
    const daily = await getDailyPrints(db, company.id, pFrom, pTo, TZ);
    expect(daily.length).toBeGreaterThan(0);
    for (const status of ["en-curso", "completada", "fallida", "cancelada"] as const) await listPrintJobs(db, company.id, { from, to, status, q: "tecla", machineId: machine.id });
  });

  it("materiales, productos y energía", async () => {
    await listMaterials(db, company.id, { lowOnly: true });
    await listMaterials(db, company.id, { q: "PLA", kind: "filament" });
    await getMaterialKpis(db, company.id, range.from, range.to);
    const [material] = await db.select({ id: materials.id }).from(materials).where(eq(materials.companyId, company.id)).limit(1);
    expect(await getMaterial(db, company.id, material.id, addDays(today, -30), months)).toBeTruthy();

    await listProducts(db, company.id, { since30: addDays(today, -30) });
    const [product] = await db.select({ id: products.id }).from(products).where(eq(products.companyId, company.id)).limit(1);
    expect(await getProduct(db, company.id, product.id, { d30: addDays(today, -30), d90: addDays(today, -90), d365: addDays(today, -365) }, months)).toBeTruthy();

    await getEnergyMonth(db, company.id, from, to, TZ, new Date());
    await getEnergyByMonth(db, company.id, months, TZ, startOfDayInZone(`${months[0]}-01`, TZ));
    await listEnergyBills(db, company.id);
    expect((await db.select({ id: machines.id }).from(machines)).length).toBeGreaterThan(0);
  });
});
