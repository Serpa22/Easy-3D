/**
 * Gastos recurrentes (suscripciones, alquiler, cuotas…).
 *
 * Cada gasto recurrente genera un movimiento por cada fecha de cargo vencida.
 * La generación es idempotente: identidad = (recurring, id, fecha de cargo).
 * Los movimientos generados son hechos contables: cambiar o borrar la
 * definición no altera los cargos pasados.
 */
import "server-only";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { recurringExpenses, type RecurringExpense } from "@/server/db/schema";
import type { RecurringFrequency, TransactionCategory } from "@/lib/domain";
import { addMonthsToDate } from "@/lib/dates";
import { ActionError } from "@/server/action";
import { syncLedgerEntry } from "./ledger";

const STEP_MONTHS: Record<RecurringFrequency, number> = { monthly: 1, quarterly: 3, yearly: 12 };
/** Tope de cargos generados de una vez por gasto (protege ante fechas absurdas). */
const MAX_CHARGES_PER_RUN = 240;

/**
 * Fechas de cargo pendientes de generar hasta `today` (inclusive).
 * Los cargos caen el mismo día del mes que `startDate` (ajustado a fin de mes).
 */
export function pendingChargeDates(
  rec: Pick<RecurringExpense, "startDate" | "endDate" | "frequency" | "lastGeneratedDate" | "active"> & { chargeFrom?: string | null },
  today: string,
): string[] {
  if (!rec.active) return [];
  const step = STEP_MONTHS[rec.frequency];
  const limit = rec.endDate && rec.endDate < today ? rec.endDate : today;
  const out: string[] = [];
  for (let k = 0; k < 2400 && out.length < MAX_CHARGES_PER_RUN; k++) {
    // Siempre desde la fecha inicial: así el día 31 no se «degrada» a 28 para siempre.
    const date = addMonthsToDate(rec.startDate, k * step);
    if (date > limit) break;
    if (rec.lastGeneratedDate && date <= rec.lastGeneratedDate) continue;
    // Periodos en pausa o ya cubiertos por el calendario anterior: no se cobran.
    if (rec.chargeFrom && date < rec.chargeFrom) continue;
    out.push(date);
  }
  return out;
}

/** Próxima fecha de cargo estrictamente posterior a `after` (o null si ya terminó o está inactivo). */
export function nextChargeDate(
  rec: Pick<RecurringExpense, "startDate" | "endDate" | "frequency" | "active">,
  after: string,
): string | null {
  if (!rec.active) return null;
  const step = STEP_MONTHS[rec.frequency];
  for (let k = 0; k < 2400; k++) {
    const date = addMonthsToDate(rec.startDate, k * step);
    if (rec.endDate && date > rec.endDate) return null;
    if (date > after) return date;
  }
  return null;
}

/** Importe equivalente al mes de un gasto recurrente (para totales «al mes»). */
export function monthlyEquivalentCents(rec: Pick<RecurringExpense, "amountCents" | "frequency">): number {
  return Math.round(rec.amountCents / STEP_MONTHS[rec.frequency]);
}

/**
 * Genera los cargos vencidos de los gastos recurrentes activos de una empresa.
 * Barato cuando no hay nada pendiente. Devuelve cuántos movimientos creó.
 */
export async function generateRecurringCharges(db: DbOrTx, companyId: string, today: string): Promise<number> {
  const candidates = await db
    .select()
    .from(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.companyId, companyId),
        eq(recurringExpenses.active, true),
        lte(recurringExpenses.startDate, today),
        or(isNull(recurringExpenses.lastGeneratedDate), lte(recurringExpenses.lastGeneratedDate, today)),
      ),
    );

  let created = 0;
  for (const rec of candidates) {
    const dates = pendingChargeDates(rec, today);
    if (dates.length === 0) continue;
    for (const date of dates) {
      await syncLedgerEntry(db, {
        companyId,
        sourceType: "recurring",
        sourceId: rec.id,
        sourceKey: date,
        type: "expense",
        category: rec.category as TransactionCategory,
        amountCents: rec.amountCents,
        vatRatePct: rec.vatRatePct,
        date,
        description: rec.name,
        counterparty: rec.counterparty,
      });
      created += 1;
    }
    await db
      .update(recurringExpenses)
      .set({ lastGeneratedDate: dates[dates.length - 1] })
      .where(and(eq(recurringExpenses.id, rec.id), eq(recurringExpenses.companyId, companyId)));
  }
  return created;
}

const later = (...dates: Array<string | null | undefined>): string | null => dates.filter((d): d is string => Boolean(d)).sort().pop() ?? null;

export interface RecurringInput {
  name: string;
  category: string;
  amountCents: number;
  vatRatePct: number;
  frequency: RecurringFrequency;
  startDate: string;
  endDate: string | null;
  counterparty: string | null;
  active: boolean;
}

/**
 * Crea o edita un gasto recurrente y genera sus cargos vencidos.
 *
 * Al editar:
 *  - si se reactiva, los cargos del tiempo en pausa NO se generan;
 *  - si cambia el calendario (fecha inicial o frecuencia) y ya tenía cargos, el
 *    periodo ya cobrado no se vuelve a cobrar: el calendario nuevo rige desde
 *    que termina ese periodo.
 */
export async function saveRecurring(db: DbOrTx, companyId: string, id: string | null, input: RecurringInput, today: string): Promise<{ id: string; created: number }> {
  let recurringId = id;
  if (id) {
    const [existing] = await db.select().from(recurringExpenses).where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.companyId, companyId))).limit(1);
    if (!existing) throw new ActionError("El gasto recurrente ya no existe.");
    let chargeFrom = existing.chargeFrom;
    const scheduleChanged = existing.startDate !== input.startDate || existing.frequency !== input.frequency;
    if (scheduleChanged && existing.lastGeneratedDate) {
      chargeFrom = later(chargeFrom, today, addMonthsToDate(existing.lastGeneratedDate, STEP_MONTHS[existing.frequency]));
    }
    if (!existing.active && input.active) chargeFrom = later(chargeFrom, today);
    await db.update(recurringExpenses).set({ ...input, chargeFrom }).where(eq(recurringExpenses.id, existing.id));
  } else {
    const [row] = await db.insert(recurringExpenses).values({ ...input, companyId }).returning({ id: recurringExpenses.id });
    recurringId = row.id;
  }
  // Los cargos ya vencidos aparecen al momento en Movimientos.
  const created = await generateRecurringCharges(db, companyId, today);
  return { id: recurringId!, created };
}

/**
 * Pausa o reanuda un gasto recurrente.
 * Al pausar se generan antes los cargos que ya habían vencido; al reanudar, los
 * del tiempo en pausa se descartan (el siguiente cargo es el primero desde hoy).
 */
export async function setRecurringActive(db: DbOrTx, companyId: string, id: string, active: boolean, today: string): Promise<void> {
  const [existing] = await db.select().from(recurringExpenses).where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.companyId, companyId))).limit(1);
  if (!existing) throw new ActionError("El gasto recurrente ya no existe.");
  if (existing.active === active) return;
  if (!active) {
    await generateRecurringCharges(db, companyId, today);
    await db.update(recurringExpenses).set({ active: false }).where(eq(recurringExpenses.id, existing.id));
  } else {
    await db.update(recurringExpenses).set({ active: true, chargeFrom: later(existing.chargeFrom, today) }).where(eq(recurringExpenses.id, existing.id));
    await generateRecurringCharges(db, companyId, today);
  }
}
