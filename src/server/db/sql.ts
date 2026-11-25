/** Atajos SQL que devuelven `number` de JS con cualquiera de los dos drivers. */
import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/** SUM(col) como número (0 si no hay filas). Para céntimos, gramos, kWh… */
export function sum(col: AnyColumn | SQL): SQL<number> {
  return sql<number>`coalesce(sum(${col}), 0)::double precision`.mapWith(Number);
}

/** COUNT(*) como número. */
export function count(): SQL<number> {
  return sql<number>`count(*)::int`.mapWith(Number);
}

/** SUM(col) solo de las filas que cumplen `condition`. */
export function sumWhere(col: AnyColumn | SQL, condition: SQL): SQL<number> {
  return sql<number>`coalesce(sum(${col}) filter (where ${condition}), 0)::double precision`.mapWith(Number);
}

/** COUNT(*) solo de las filas que cumplen `condition`. */
export function countWhere(condition: SQL): SQL<number> {
  return sql<number>`(count(*) filter (where ${condition}))::int`.mapWith(Number);
}

/** 'YYYY-MM' de una columna `date`. */
export function monthKey(col: AnyColumn): SQL<string> {
  return sql<string>`to_char(${col}, 'YYYY-MM')`;
}

/**
 * Un instante (`Date`) como parámetro dentro de una plantilla sql``.
 *
 * Fuera de `eq()/gte()/lt()` Drizzle no sabe a qué columna pertenece el valor y
 * no lo convierte: PGlite lo acepta, pero postgres-js falla con un `Date` suelto.
 * Usa siempre este atajo (o los operadores de Drizzle) para comparar instantes.
 */
export function instant(date: Date): SQL {
  return sql`${date.toISOString()}::timestamptz`;
}
