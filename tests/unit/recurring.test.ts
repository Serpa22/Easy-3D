import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { recurringExpenses, transactions } from "@/server/db/schema";
import { generateRecurringCharges, monthlyEquivalentCents, nextChargeDate, pendingChargeDates } from "@/server/domain/recurring";
import { freshDb, makeCompany } from "../helpers/db";

beforeEach(async () => {
  await freshDb();
});

const base = { startDate: "2026-01-31", endDate: null, frequency: "monthly" as const, lastGeneratedDate: null, active: true };

describe("gastos recurrentes", () => {
  it("calcula las fechas de cargo pendientes", () => {
    expect(pendingChargeDates(base, "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(pendingChargeDates({ ...base, lastGeneratedDate: "2026-02-28" }, "2026-04-29")).toEqual(["2026-03-31"]);
    expect(pendingChargeDates({ ...base, endDate: "2026-02-15" }, "2026-12-31")).toEqual(["2026-01-31"]);
    expect(pendingChargeDates({ ...base, active: false }, "2026-12-31")).toEqual([]);
    expect(pendingChargeDates({ ...base, startDate: "2027-01-01" }, "2026-12-31")).toEqual([]);
    expect(pendingChargeDates({ ...base, startDate: "2025-03-10", frequency: "quarterly" }, "2026-01-01")).toEqual([
      "2025-03-10",
      "2025-06-10",
      "2025-09-10",
      "2025-12-10",
    ]);
    expect(pendingChargeDates({ ...base, startDate: "2024-02-29", frequency: "yearly" }, "2026-03-01")).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
    ]);
  });

  it("calcula el próximo cargo y el equivalente mensual", () => {
    expect(nextChargeDate(base, "2026-02-28")).toBe("2026-03-31");
    expect(nextChargeDate({ ...base, endDate: "2026-03-01" }, "2026-02-28")).toBeNull();
    expect(nextChargeDate({ ...base, active: false }, "2026-02-28")).toBeNull();
    expect(monthlyEquivalentCents({ amountCents: 12000, frequency: "yearly" })).toBe(1000);
    expect(monthlyEquivalentCents({ amountCents: 999, frequency: "monthly" })).toBe(999);
  });

  it("genera cargos vencidos una sola vez", async () => {
    const db = await getDb();
    const company = await makeCompany();
    const other = await makeCompany("Figuras");
    const [rec] = await db
      .insert(recurringExpenses)
      .values({ companyId: company.id, name: "Suscripción slicer", category: "software", amountCents: 1299, startDate: "2026-09-15", counterparty: "Slicer Pro" })
      .returning();
    await db.insert(recurringExpenses).values({ companyId: other.id, name: "Hosting", category: "software", amountCents: 500, startDate: "2026-09-01" });

    expect(await generateRecurringCharges(db, company.id, "2026-11-25")).toBe(3);
    expect(await generateRecurringCharges(db, company.id, "2026-11-25")).toBe(0);
    let rows = await db.select().from(transactions).where(eq(transactions.companyId, company.id));
    expect(rows.map((r) => r.date).sort()).toEqual(["2026-09-15", "2026-10-15", "2026-11-15"]);
    expect(rows.every((r) => r.amountCents === 1299 && r.category === "software" && r.sourceType === "recurring")).toBe(true);
    // No toca la otra empresa.
    expect(await db.select().from(transactions).where(eq(transactions.companyId, other.id))).toHaveLength(0);

    // Un cambio de importe solo afecta a cargos futuros.
    await db.update(recurringExpenses).set({ amountCents: 1499 }).where(eq(recurringExpenses.id, rec.id));
    expect(await generateRecurringCharges(db, company.id, "2026-12-20")).toBe(1);
    rows = await db.select().from(transactions).where(eq(transactions.companyId, company.id));
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.date === "2026-12-15")?.amountCents).toBe(1499);
    expect(rows.find((r) => r.date === "2026-11-15")?.amountCents).toBe(1299);

    // Un cargo borrado a mano no reaparece.
    await db.delete(transactions).where(eq(transactions.date, "2026-10-15"));
    expect(await generateRecurringCharges(db, company.id, "2026-12-25")).toBe(0);
    expect(await db.select().from(transactions).where(eq(transactions.companyId, company.id))).toHaveLength(3);
  });
});
