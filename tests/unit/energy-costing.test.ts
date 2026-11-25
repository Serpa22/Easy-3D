import { describe, expect, it } from "vitest";
import { averageKwhPrice, energyCost, energyKwh, splitSecondsByPeriod, tariffPeriodAt, type ElectricityTariff } from "@/lib/energy";
import { computeUnitCost, marginOf, netOfVat, suggestedPriceCents, vatPortion } from "@/lib/costing";

const fixed: ElectricityTariff = { electricityMode: "fixed", kwhPrice: 0.2, kwhPricePeak: 0.3, kwhPriceFlat: 0.2, kwhPriceValley: 0.1 };
const tou: ElectricityTariff = { ...fixed, electricityMode: "tou" };

describe("tarifa 2.0TD", () => {
  it("asigna periodos en laborables (hora de Madrid)", () => {
    // Miércoles 25 nov 2026 (UTC+1)
    expect(tariffPeriodAt(new Date("2026-11-25T03:00:00+01:00"))).toBe("valley");
    expect(tariffPeriodAt(new Date("2026-11-25T08:30:00+01:00"))).toBe("flat");
    expect(tariffPeriodAt(new Date("2026-11-25T11:00:00+01:00"))).toBe("peak");
    expect(tariffPeriodAt(new Date("2026-11-25T15:00:00+01:00"))).toBe("flat");
    expect(tariffPeriodAt(new Date("2026-11-25T19:00:00+01:00"))).toBe("peak");
    expect(tariffPeriodAt(new Date("2026-11-25T23:00:00+01:00"))).toBe("flat");
  });
  it("fines de semana y festivos nacionales son valle", () => {
    expect(tariffPeriodAt(new Date("2026-11-28T12:00:00+01:00"))).toBe("valley"); // sábado
    expect(tariffPeriodAt(new Date("2026-11-29T20:00:00+01:00"))).toBe("valley"); // domingo
    expect(tariffPeriodAt(new Date("2026-12-08T12:00:00+01:00"))).toBe("valley"); // Inmaculada (martes)
    expect(tariffPeriodAt(new Date("2026-01-06T12:00:00+01:00"))).toBe("valley"); // Reyes (martes)
  });
  it("respeta el horario de verano", () => {
    // 15 jul 2026 (miércoles): 09:00 UTC = 11:00 en Madrid → punta
    expect(tariffPeriodAt(new Date("2026-07-15T09:00:00Z"))).toBe("peak");
    // 07:30 UTC = 09:30 en Madrid → llano
    expect(tariffPeriodAt(new Date("2026-07-15T07:30:00Z"))).toBe("flat");
  });
  it("reparte una impresión larga entre periodos", () => {
    // Miércoles 07:00 → 11:00: 1 h valle, 2 h llano, 1 h punta
    const split = splitSecondsByPeriod(new Date("2026-11-25T07:00:00+01:00"), 4 * 3600);
    expect(split).toEqual({ valley: 3600, flat: 7200, peak: 3600 });
    const total = Object.values(splitSecondsByPeriod(new Date("2026-11-25T07:10:00+01:00"), 12345)).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(12345, 6);
  });
});

describe("coste de energía", () => {
  it("calcula kWh", () => {
    expect(energyKwh(1000, 3600)).toBe(1);
    expect(energyKwh(150, 2 * 3600)).toBeCloseTo(0.3, 10);
    expect(energyKwh(-5, 100)).toBe(0);
  });
  it("tarifa fija", () => {
    const r = energyCost(fixed, { start: new Date("2026-11-25T07:00:00+01:00"), durationSec: 4 * 3600, watts: 250 });
    expect(r.kwh).toBeCloseTo(1, 10);
    expect(r.costCents).toBe(20);
  });
  it("tarifa por periodos", () => {
    // 1 kWh en 4 h: 0,25 valle (0,10) + 0,5 llano (0,20) + 0,25 punta (0,30) = 0,20 €
    const r = energyCost(tou, { start: new Date("2026-11-25T07:00:00+01:00"), durationSec: 4 * 3600, watts: 250 });
    expect(r.kwhByPeriod.valley).toBeCloseTo(0.25, 10);
    expect(r.kwhByPeriod.flat).toBeCloseTo(0.5, 10);
    expect(r.kwhByPeriod.peak).toBeCloseTo(0.25, 10);
    expect(r.costCents).toBe(20);
    // La misma impresión en domingo cuesta la mitad (todo valle).
    const sunday = energyCost(tou, { start: new Date("2026-11-29T07:00:00+01:00"), durationSec: 4 * 3600, watts: 250 });
    expect(sunday.costCents).toBe(10);
  });
  it("precio medio ponderado", () => {
    expect(averageKwhPrice(fixed)).toBe(0.2);
    expect(averageKwhPrice(tou)).toBeCloseTo((0.1 * 88 + 0.2 * 40 + 0.3 * 40) / 168, 10);
  });
});

describe("coste de producto", () => {
  const base = {
    materialQty: 50,
    materialPackCostCents: 2000,
    materialPackSize: 1000,
    printMinutes: 120,
    machinePowerW: 150,
    kwhPrice: 0.2,
    machinePurchasePriceCents: 50000,
    machineLifespanHours: 5000,
    laborMinutes: 6,
    laborRateCents: 1500,
    packagingCostCents: 35,
    otherCostCents: 0,
    failureRatePct: 0,
  };
  it("desglosa el coste unitario", () => {
    const c = computeUnitCost(base);
    expect(c.materialCents).toBe(100); // 50 g de una bobina de 20 €/kg
    expect(c.energyCents).toBe(6); // 0,15 kW × 2 h × 0,20 €
    expect(c.depreciationCents).toBe(20); // 500 € / 5000 h × 2 h
    expect(c.laborCents).toBe(150); // 6 min a 15 €/h
    expect(c.packagingCents).toBe(35);
    expect(c.failureCents).toBe(0);
    expect(c.totalCents).toBe(311);
  });
  it("los fallos encarecen material, energía y máquina", () => {
    const c = computeUnitCost({ ...base, failureRatePct: 20 });
    // (100 + 6 + 20) × 0,2 / 0,8 = 31,5 → 32
    expect(c.failureCents).toBe(32);
    expect(c.totalCents).toBe(343);
  });
  it("no revienta con datos vacíos o absurdos", () => {
    const c = computeUnitCost({ ...base, materialPackSize: 0, machineLifespanHours: 0, printMinutes: NaN, failureRatePct: 150 });
    expect(c.materialCents).toBe(0);
    expect(c.depreciationCents).toBe(0);
    expect(c.energyCents).toBe(0);
    expect(Number.isFinite(c.totalCents)).toBe(true);
  });
  it("calcula IVA, margen y precio recomendado", () => {
    expect(netOfVat(1210, 21)).toBe(1000);
    expect(vatPortion(1210, 21)).toBe(210);
    const m = marginOf(1210, 400, 21);
    expect(m.netCents).toBe(1000);
    expect(m.profitCents).toBe(600);
    expect(m.marginPct).toBeCloseTo(60, 6);
    expect(m.markupPct).toBeCloseTo(150, 6);
    // Coste 4,00 €, margen 60 % → neto 10,00 € → 12,10 € con IVA
    expect(suggestedPriceCents(400, 60, 21)).toBe(1210);
    expect(suggestedPriceCents(400, 60, 21, 50)).toBe(1250);
    // y el precio recomendado cumple el margen objetivo
    expect(marginOf(suggestedPriceCents(311, 60, 21), 311, 21).marginPct).toBeGreaterThanOrEqual(60);
  });
});
