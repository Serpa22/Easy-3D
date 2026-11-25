import { describe, expect, it } from "vitest";
import { formatDuration, formatMoney, formatMoneySigned, formatWeight, centsToInput } from "@/lib/format";
import { parseDecimal, parseMoneyToCents, zCents, zDate, zOptionalCents, zOptionalText, zCheckbox, zInt } from "@/lib/validation";
import { addMonths, addMonthsToDate, dateToISO, isISODate, lastMonths, monthRange, startOfDayInZone, todayISO } from "@/lib/dates";

const nbsp = (s: string) => s.replace(/ | /g, " ");

describe("format", () => {
  it("formatea dinero en es-ES desde céntimos", () => {
    expect(nbsp(formatMoney(123456))).toBe("1.234,56 €");
    expect(nbsp(formatMoney(1234567))).toBe("12.345,67 €");
    expect(nbsp(formatMoney(0))).toBe("0,00 €");
    expect(nbsp(formatMoney(null))).toBe("0,00 €");
    expect(nbsp(formatMoneySigned(-500))).toBe("−5,00 €");
    expect(nbsp(formatMoneySigned(500))).toBe("+5,00 €");
    expect(centsToInput(1250)).toBe("12,50");
    expect(centsToInput(null)).toBe("");
  });
  it("formatea duraciones y pesos", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(45 * 60)).toBe("45 min");
    expect(formatDuration(2 * 3600 + 5 * 60)).toBe("2 h 05 min");
    expect(formatDuration(26 * 3600)).toBe("1 d 2 h");
    expect(nbsp(formatWeight(850))).toBe("850 g");
    expect(nbsp(formatWeight(1250))).toBe("1,25 kg");
  });
});

describe("validation", () => {
  it("interpreta decimales con coma, punto y miles", () => {
    expect(parseDecimal("12,5")).toBe(12.5);
    expect(parseDecimal("12.5")).toBe(12.5);
    expect(parseDecimal("1.234,56")).toBe(1234.56);
    expect(parseDecimal("1,234.56")).toBe(1234.56);
    expect(parseDecimal(" 19,99 € ")).toBe(19.99);
    expect(parseDecimal("1.005")).toBe(1005); // punto + tres cifras = miles (es-ES)
    expect(parseDecimal("12.500")).toBe(12500);
    expect(parseDecimal("1.234.567")).toBe(1234567);
    expect(parseDecimal("0.25")).toBe(0.25);
    expect(parseDecimal("1.2345")).toBe(1.2345);
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("1,2,3")).toBeNull();
  });
  it("convierte importes a céntimos sin errores de coma flotante", () => {
    expect(parseMoneyToCents("19,99")).toBe(1999);
    expect(parseMoneyToCents("0,1")).toBe(10);
    expect(parseMoneyToCents("1,005")).toBe(101); // 1,005 € → redondeo comercial
    expect(parseMoneyToCents("1.005")).toBe(100500); // mil cinco euros
    expect(parseMoneyToCents("-2,5")).toBe(-250);
    expect(parseMoneyToCents("4,35")).toBe(435);
    expect(parseMoneyToCents("1234")).toBe(123400);
  });
  it("zCents exige valor, rechaza negativos y basura", () => {
    expect(zCents().parse("12,50")).toBe(1250);
    expect(zCents().safeParse("").success).toBe(false);
    expect(zCents().safeParse(undefined).success).toBe(false);
    expect(zCents().safeParse("-1").success).toBe(false);
    expect(zCents().safeParse("doce").success).toBe(false);
    expect(zCents({ min: 1 }).safeParse("0").success).toBe(false);
  });
  it("opcionales devuelven su valor por defecto", () => {
    expect(zOptionalCents().parse("")).toBe(0);
    expect(zOptionalCents(null).parse(undefined)).toBeNull();
    expect(zOptionalCents().parse("3")).toBe(300);
    expect(zOptionalText().parse("   ")).toBeNull();
    expect(zOptionalText().parse(" hola ")).toBe("hola");
    expect(zCheckbox().parse("on")).toBe(true);
    expect(zCheckbox().parse(undefined)).toBe(false);
    expect(zInt({ min: 1 }).parse("3")).toBe(3);
    expect(zInt().safeParse("3,5").success).toBe(false);
  });
  it("valida fechas reales", () => {
    expect(zDate().parse("2026-11-25")).toBe("2026-11-25");
    expect(zDate().safeParse("2026-02-30").success).toBe(false);
    expect(zDate().safeParse("").success).toBe(false);
    expect(isISODate("2024-02-29")).toBe(true);
    expect(isISODate("2025-02-29")).toBe(false);
  });
});

describe("dates", () => {
  it("calcula «hoy» en la zona horaria de la organización", () => {
    // 23:30 UTC del 31 de diciembre ya es 1 de enero en Madrid (UTC+1).
    expect(todayISO("Europe/Madrid", new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(todayISO("UTC", new Date("2026-12-31T23:30:00Z"))).toBe("2026-12-31");
    expect(dateToISO(new Date("2026-06-15T22:30:00Z"), "Europe/Madrid")).toBe("2026-06-16");
  });
  it("opera con meses", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonthsToDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(monthRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(lastMonths(3, "2026-01")).toEqual(["2025-11", "2025-12", "2026-01"]);
  });
  it("encuentra el inicio del día local, también con cambio de hora", () => {
    expect(startOfDayInZone("2026-07-01", "Europe/Madrid").toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(startOfDayInZone("2026-01-15", "Europe/Madrid").toISOString()).toBe("2026-01-14T23:00:00.000Z");
    // 29-mar-2026: empieza el horario de verano a las 02:00; la medianoche sigue en UTC+1.
    expect(startOfDayInZone("2026-03-29", "Europe/Madrid").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    // 25-oct-2026: termina el horario de verano; la medianoche sigue en UTC+2.
    expect(startOfDayInZone("2026-10-25", "Europe/Madrid").toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });
});
