/**
 * Piezas de validación (zod) para formularios. Aceptan lo que escribe una
 * persona: decimales con coma, campos vacíos, espacios…
 */
import { z } from "zod";
import { isISODate } from "./dates";

z.config(z.locales.es());

/**
 * Texto de una persona → número. Devuelve null si no es válido.
 *
 * Convención es-ES: la coma es el separador decimal y el punto el de miles.
 *   «12,5» → 12.5 · «1.234,56» → 1234.56 · «1.005» → 1005 · «12.500» → 12500
 * Por comodidad (teclado numérico) un único punto que NO va seguido de
 * exactamente tres cifras se acepta como decimal: «12.5» → 12.5, «0.25» → 0.25.
 * El formato anglosajón completo también se entiende: «1,234.56» → 1234.56.
 */
export function parseDecimal(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  let s = input.trim().replace(/\s|€|%/g, "");
  if (s === "") return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // El último separador es el decimal; el otro, de miles.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    s = s.replace(",", ".");
  } else if (hasDot && /^[+-]?\d{1,3}(\.\d{3})+$/.test(s)) {
    // Solo puntos en grupos de tres: separadores de miles.
    s = s.replace(/\./g, "");
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Texto de importe → céntimos enteros (redondeo comercial). */
export function parseMoneyToCents(input: unknown): number | null {
  const n = parseDecimal(input);
  if (n === null) return null;
  const sign = n < 0 ? -1 : 1;
  return sign * Math.round((Math.abs(n) + Number.EPSILON) * 100);
}

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Texto obligatorio (recortado). */
export const zText = (max = 200) =>
  z
    .string({ error: "Campo obligatorio" })
    .trim()
    .min(1, "Campo obligatorio")
    .max(max, `Máximo ${max} caracteres`);

/** Texto opcional: vacío → null. */
export const zOptionalText = (max = 2000) =>
  z.preprocess(
    emptyToUndefined,
    z.string().trim().max(max, `Máximo ${max} caracteres`).optional(),
  ).transform((v) => v ?? null);

/** Importe obligatorio en euros → céntimos (≥ 0 por defecto). */
export const zCents = (opts: { min?: number; max?: number } = {}) =>
  z.preprocess(
    emptyToUndefined,
    z
      .unknown()
      .refine((v) => v !== undefined, "Campo obligatorio")
      .transform((v, ctx) => {
        const cents = parseMoneyToCents(v);
        if (cents === null) {
          ctx.addIssue({ code: "custom", message: "Importe no válido" });
          return z.NEVER;
        }
        const min = opts.min ?? 0;
        const max = opts.max ?? 1_000_000_000;
        if (cents < min) {
          ctx.addIssue({ code: "custom", message: min === 0 ? "No puede ser negativo" : "Importe demasiado bajo" });
          return z.NEVER;
        }
        if (cents > max) {
          ctx.addIssue({ code: "custom", message: "Importe demasiado alto" });
          return z.NEVER;
        }
        return cents;
      }),
  );

/** Importe opcional: vacío → `fallback` (0 por defecto). */
export const zOptionalCents = (fallback: number | null = 0) =>
  z.preprocess(
    emptyToUndefined,
    z
      .unknown()
      .transform((v, ctx) => {
        if (v === undefined) return fallback;
        const cents = parseMoneyToCents(v);
        if (cents === null || cents < 0 || cents > 1_000_000_000) {
          ctx.addIssue({ code: "custom", message: "Importe no válido" });
          return z.NEVER;
        }
        return cents;
      }),
  );

/** Número decimal obligatorio (acepta coma). */
export const zDecimal = (opts: { min?: number; max?: number } = {}) =>
  z.preprocess(
    emptyToUndefined,
    z
      .unknown()
      .refine((v) => v !== undefined, "Campo obligatorio")
      .transform((v, ctx) => {
        const n = parseDecimal(v);
        if (n === null) {
          ctx.addIssue({ code: "custom", message: "Número no válido" });
          return z.NEVER;
        }
        if (opts.min !== undefined && n < opts.min) {
          ctx.addIssue({ code: "custom", message: `Debe ser como mínimo ${opts.min}` });
          return z.NEVER;
        }
        if (opts.max !== undefined && n > opts.max) {
          ctx.addIssue({ code: "custom", message: `Debe ser como máximo ${opts.max}` });
          return z.NEVER;
        }
        return n;
      }),
  );

/** Número decimal opcional: vacío → `fallback`. */
export const zOptionalDecimal = (fallback: number | null = 0, opts: { min?: number; max?: number } = {}) =>
  z.preprocess(
    emptyToUndefined,
    z.unknown().transform((v, ctx) => {
      if (v === undefined) return fallback;
      const n = parseDecimal(v);
      if (n === null || (opts.min !== undefined && n < opts.min) || (opts.max !== undefined && n > opts.max)) {
        ctx.addIssue({ code: "custom", message: "Número no válido" });
        return z.NEVER;
      }
      return n;
    }),
  );

/** Entero obligatorio. */
export const zInt = (opts: { min?: number; max?: number } = {}) =>
  zDecimal(opts).refine((n) => Number.isInteger(n), "Debe ser un número entero");

/** Entero opcional: vacío → `fallback`. */
export const zOptionalInt = (fallback: number | null = 0, opts: { min?: number; max?: number } = {}) =>
  zOptionalDecimal(fallback, opts).refine((n) => n === null || Number.isInteger(n), "Debe ser un número entero");

/** Fecha 'YYYY-MM-DD' obligatoria. */
export const zDate = () =>
  z.preprocess(
    emptyToUndefined,
    z.string({ error: "Fecha obligatoria" }).refine(isISODate, "Fecha no válida"),
  );

/** Fecha opcional: vacío → null. */
export const zOptionalDate = () =>
  z
    .preprocess(emptyToUndefined, z.string().refine(isISODate, "Fecha no válida").optional())
    .transform((v) => v ?? null);

/** UUID obligatorio. */
export const zId = () => z.uuid("Identificador no válido");

/** UUID opcional: vacío → null. */
export const zOptionalId = () =>
  z.preprocess(emptyToUndefined, z.uuid("Identificador no válido").optional()).transform((v) => v ?? null);

/** Casilla de formulario: «on» / «true» / «1» → true. */
export const zCheckbox = () =>
  z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean());

/** Color #RRGGBB opcional. */
export const zOptionalColor = () =>
  z
    .preprocess(emptyToUndefined, z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color no válido").optional())
    .transform((v) => (v ? v.toLowerCase() : null));

export { z };
