/** Informes anuales de finanzas. Todo agregado en SQL y filtrado por empresa. */
import "server-only";
import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { transactions } from "@/server/db/schema";
import { sum } from "@/server/db/sql";

/** Cuota de IVA contenida en cada movimiento (redondeada por fila, como en la exportación). */
const vatPortion = sql<number>`(${transactions.amountCents} - round(${transactions.amountCents} / (1 + ${transactions.vatRatePct} / 100.0)))`;

export async function getYearReport(db: DbOrTx, companyId: string, year: number) {
  const range = and(eq(transactions.companyId, companyId), gte(transactions.date, `${year}-01-01`), lte(transactions.date, `${year}-12-31`));
  const quarter = sql<number>`extract(quarter from ${transactions.date})::int`.mapWith(Number);
  const [byCategory, vat, counterparties, years] = await Promise.all([
    db
      .select({ type: transactions.type, category: transactions.category, quarter, cents: sum(transactions.amountCents) })
      .from(transactions)
      .where(range)
      .groupBy(transactions.type, transactions.category, sql`3`),
    db
      .select({ type: transactions.type, quarter, vatCents: sql<number>`coalesce(sum(${vatPortion}), 0)::double precision`.mapWith(Number) })
      .from(transactions)
      .where(range)
      .groupBy(transactions.type, sql`2`),
    db
      .select({ type: transactions.type, counterparty: transactions.counterparty, cents: sum(transactions.amountCents) })
      .from(transactions)
      .where(and(range, isNotNull(transactions.counterparty)))
      .groupBy(transactions.type, transactions.counterparty)
      .orderBy(desc(sum(transactions.amountCents)))
      .limit(60),
    db
      .selectDistinct({ year: sql<number>`extract(year from ${transactions.date})::int`.mapWith(Number) })
      .from(transactions)
      .where(eq(transactions.companyId, companyId)),
  ]);
  return { byCategory, vat, counterparties, years: years.map((y) => y.year) };
}
