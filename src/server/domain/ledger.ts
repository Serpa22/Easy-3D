/**
 * Libro contable derivado.
 *
 * Muchos ingresos y gastos nacen de otro registro: un pedido cobrado, el coste
 * de un envío, una compra de material, un mantenimiento, una factura de luz…
 * Esos movimientos NO se insertan a mano: se sincronizan con su origen para
 * que editar o borrar el origen actualice las finanzas sin duplicados.
 *
 * Identidad de un movimiento derivado: (sourceType, sourceId, sourceKey).
 */
import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { transactions } from "@/server/db/schema";
import type { PaymentMethod, TransactionCategory, TransactionSource, TransactionType } from "@/lib/domain";

export type DerivedSource = Exclude<TransactionSource, "manual">;

export interface LedgerEntryInput {
  companyId: string;
  sourceType: DerivedSource;
  sourceId: string;
  /** Distingue varios movimientos del mismo origen (p. ej. el periodo de un cargo recurrente). */
  sourceKey?: string;
  type: TransactionType;
  category: TransactionCategory;
  /** Importe total positivo, IVA incluido. Si es ≤ 0 el movimiento se elimina. */
  amountCents: number;
  vatRatePct?: number;
  /** 'YYYY-MM-DD' */
  date: string;
  description: string;
  counterparty?: string | null;
  paymentMethod?: PaymentMethod | null;
  machineId?: string | null;
}

/**
 * Crea o actualiza el movimiento derivado de un origen (idempotente).
 * Llamar siempre que el origen cambie; con `amountCents <= 0` lo elimina.
 */
export async function syncLedgerEntry(db: DbOrTx, input: LedgerEntryInput): Promise<void> {
  const sourceKey = input.sourceKey ?? "";
  const match = and(
    eq(transactions.companyId, input.companyId),
    eq(transactions.sourceType, input.sourceType),
    eq(transactions.sourceId, input.sourceId),
    eq(transactions.sourceKey, sourceKey),
  );

  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    await db.delete(transactions).where(match);
    return;
  }

  const values = {
    type: input.type,
    category: input.category,
    amountCents: Math.round(input.amountCents),
    vatRatePct: input.vatRatePct ?? 21,
    date: input.date,
    description: input.description,
    counterparty: input.counterparty ?? null,
    paymentMethod: input.paymentMethod ?? null,
    machineId: input.machineId ?? null,
  };

  const existing = await db.select({ id: transactions.id }).from(transactions).where(match).limit(1);
  if (existing[0]) {
    await db.update(transactions).set(values).where(eq(transactions.id, existing[0].id));
  } else {
    await db.insert(transactions).values({
      ...values,
      companyId: input.companyId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceKey,
    });
  }
}

/** Elimina el movimiento derivado de un origen (al borrar el origen o dejar de aplicar). */
export async function removeLedgerEntry(
  db: DbOrTx,
  ref: { companyId: string; sourceType: DerivedSource; sourceId: string; sourceKey?: string },
): Promise<void> {
  const conditions = [
    eq(transactions.companyId, ref.companyId),
    eq(transactions.sourceType, ref.sourceType),
    eq(transactions.sourceId, ref.sourceId),
  ];
  if (ref.sourceKey !== undefined) conditions.push(eq(transactions.sourceKey, ref.sourceKey));
  await db.delete(transactions).where(and(...conditions));
}

/** Elimina TODOS los movimientos derivados de un registro (cualquier tipo de origen). */
export async function removeLedgerEntriesFor(
  db: DbOrTx,
  companyId: string,
  sourceId: string,
  sourceTypes?: DerivedSource[],
): Promise<void> {
  await db
    .delete(transactions)
    .where(
      and(
        eq(transactions.companyId, companyId),
        eq(transactions.sourceId, sourceId),
        sourceTypes?.length ? inArray(transactions.sourceType, sourceTypes) : ne(transactions.sourceType, "manual"),
      ),
    );
}
