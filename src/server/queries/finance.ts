/** Lecturas del módulo de finanzas. Todas filtran por empresa. */
import "server-only";
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { transactions, type Transaction } from "@/server/db/schema";
import { count, monthKey, sum, sumWhere } from "@/server/db/sql";
import type { TransactionType } from "@/lib/domain";
import { monthRange } from "@/lib/dates";

export interface TransactionFilters {
  /** Rango de fechas contables, ambos inclusive ('YYYY-MM-DD'). */
  from?: string;
  to?: string;
  type?: TransactionType;
  category?: string;
  /** Búsqueda en concepto, proveedor/cliente y notas. */
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface PeriodSummary {
  incomeCents: number;
  expenseCents: number;
  /** ingresos − gastos */
  profitCents: number;
  count: number;
}

function where(companyId: string, f: TransactionFilters): SQL {
  const conditions: SQL[] = [eq(transactions.companyId, companyId)];
  if (f.from) conditions.push(gte(transactions.date, f.from));
  if (f.to) conditions.push(lte(transactions.date, f.to));
  if (f.type) conditions.push(eq(transactions.type, f.type));
  if (f.category) conditions.push(eq(transactions.category, f.category));
  const q = f.q?.trim();
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const match = or(
      ilike(transactions.description, pattern),
      ilike(transactions.counterparty, pattern),
      ilike(transactions.notes, pattern),
    );
    if (match) conditions.push(match);
  }
  return and(...conditions) as SQL;
}

const isIncome = sql`${transactions.type} = 'income'`;
const isExpense = sql`${transactions.type} = 'expense'`;

/** Movimientos paginados (más recientes primero) + totales del filtro completo. */
export async function listTransactions(
  db: DbOrTx,
  companyId: string,
  filters: TransactionFilters = {},
): Promise<{ rows: Transaction[]; total: number; page: number; pageCount: number; summary: PeriodSummary }> {
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 200);
  const condition = where(companyId, filters);

  const [totals] = await db
    .select({
      total: count(),
      incomeCents: sumWhere(transactions.amountCents, isIncome),
      expenseCents: sumWhere(transactions.amountCents, isExpense),
    })
    .from(transactions)
    .where(condition);

  const total = totals?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(filters.page ?? 1, 1), pageCount);

  const rows = await db
    .select()
    .from(transactions)
    .where(condition)
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const incomeCents = totals?.incomeCents ?? 0;
  const expenseCents = totals?.expenseCents ?? 0;
  return {
    rows,
    total,
    page,
    pageCount,
    summary: { incomeCents, expenseCents, profitCents: incomeCents - expenseCents, count: total },
  };
}

/** Ingresos, gastos y beneficio de un rango de fechas. */
export async function getPeriodSummary(
  db: DbOrTx,
  companyId: string,
  range: { from: string; to: string },
): Promise<PeriodSummary> {
  const [row] = await db
    .select({
      count: count(),
      incomeCents: sumWhere(transactions.amountCents, isIncome),
      expenseCents: sumWhere(transactions.amountCents, isExpense),
    })
    .from(transactions)
    .where(where(companyId, range));
  const incomeCents = row?.incomeCents ?? 0;
  const expenseCents = row?.expenseCents ?? 0;
  return { incomeCents, expenseCents, profitCents: incomeCents - expenseCents, count: row?.count ?? 0 };
}

export interface MonthlyTotal extends PeriodSummary {
  /** 'YYYY-MM' */
  month: string;
}

/** Totales por mes para la lista de meses indicada (los meses sin datos salen a cero). */
export async function getMonthlyTotals(db: DbOrTx, companyId: string, months: string[]): Promise<MonthlyTotal[]> {
  if (months.length === 0) return [];
  const sorted = [...months].sort();
  const from = monthRange(sorted[0]).from;
  const to = monthRange(sorted[sorted.length - 1]).to;
  const month = monthKey(transactions.date);
  const rows = await db
    .select({
      month,
      count: count(),
      incomeCents: sumWhere(transactions.amountCents, isIncome),
      expenseCents: sumWhere(transactions.amountCents, isExpense),
    })
    .from(transactions)
    .where(where(companyId, { from, to }))
    .groupBy(month);
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return months.map((m) => {
    const r = byMonth.get(m);
    const incomeCents = r?.incomeCents ?? 0;
    const expenseCents = r?.expenseCents ?? 0;
    return { month: m, incomeCents, expenseCents, profitCents: incomeCents - expenseCents, count: r?.count ?? 0 };
  });
}

export interface CategoryTotal {
  category: string;
  amountCents: number;
  count: number;
}

/** Importe por categoría de un tipo (ingresos o gastos) en un rango, de mayor a menor. */
export async function getCategoryBreakdown(
  db: DbOrTx,
  companyId: string,
  filter: { from: string; to: string; type: TransactionType },
): Promise<CategoryTotal[]> {
  const amount = sum(transactions.amountCents);
  return db
    .select({ category: transactions.category, amountCents: amount, count: count() })
    .from(transactions)
    .where(where(companyId, filter))
    .groupBy(transactions.category)
    .orderBy(desc(amount));
}

/** Un movimiento de la empresa, o null. */
export async function getTransaction(db: DbOrTx, companyId: string, id: string): Promise<Transaction | null> {
  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.companyId, companyId)))
    .limit(1);
  return rows[0] ?? null;
}
