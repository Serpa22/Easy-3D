"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { ActionResult, ActionState } from "@/lib/action";
import {
  categoriesFor,
  PAYMENT_METHODS,
  TRANSACTION_SOURCE_LABELS,
  TRANSACTION_TYPES,
  type TransactionCategory,
} from "@/lib/domain";
import { zCents, zDate, zId, zOptionalDecimal, zOptionalId, zOptionalText, zText } from "@/lib/validation";
import { ActionError, parseForm, parseInput, runAction } from "@/server/action";
import { requireCompany } from "@/server/context";
import { transactions } from "@/server/db/schema";

const transactionSchema = z
  .object({
    id: zOptionalId(),
    type: z.enum(TRANSACTION_TYPES, { error: "Elige ingreso o gasto" }),
    category: zText(40),
    amount: zCents({ min: 1 }),
    vatRatePct: zOptionalDecimal(21, { min: 0, max: 100 }),
    date: zDate(),
    description: zText(200),
    counterparty: zOptionalText(120),
    paymentMethod: z.preprocess((v) => (v === "" ? undefined : v), z.enum(PAYMENT_METHODS).optional()),
    notes: zOptionalText(2000),
  })
  .superRefine((value, ctx) => {
    if (!(categoriesFor(value.type) as readonly string[]).includes(value.category)) {
      ctx.addIssue({ code: "custom", path: ["category"], message: "Categoría no válida para este tipo" });
    }
  });

/** Crea o edita un movimiento manual (ingreso o gasto). */
export async function saveTransactionAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const input = parseForm(transactionSchema, formData);
    const values = {
      type: input.type,
      category: input.category as TransactionCategory,
      amountCents: input.amount,
      vatRatePct: input.vatRatePct ?? 21,
      date: input.date,
      description: input.description,
      counterparty: input.counterparty,
      paymentMethod: input.paymentMethod ?? null,
      notes: input.notes,
    };

    if (input.id) {
      const [existing] = await db
        .select({ sourceType: transactions.sourceType })
        .from(transactions)
        .where(and(eq(transactions.id, input.id), eq(transactions.companyId, company.id)))
        .limit(1);
      if (!existing) throw new ActionError("El movimiento ya no existe.");
      if (existing.sourceType !== "manual") {
        throw new ActionError(
          `Este movimiento se genera automáticamente (${TRANSACTION_SOURCE_LABELS[existing.sourceType].toLowerCase()}). Edítalo desde su origen.`,
        );
      }
      await db
        .update(transactions)
        .set(values)
        .where(and(eq(transactions.id, input.id), eq(transactions.companyId, company.id)));
    } else {
      await db.insert(transactions).values({ ...values, companyId: company.id, sourceType: "manual" });
    }

    revalidatePath(`/e/${slug}`, "layout");
    return { message: input.id ? "Movimiento actualizado" : input.type === "income" ? "Ingreso añadido" : "Gasto añadido" };
  });
}

/** Elimina un movimiento manual. Los derivados se eliminan desde su origen. */
export async function deleteTransactionAction(slug: string, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const transactionId = parseInput(zId(), id);
    const [existing] = await db
      .select({ sourceType: transactions.sourceType })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.companyId, company.id)))
      .limit(1);
    if (!existing) throw new ActionError("El movimiento ya no existe.");
    if (existing.sourceType !== "manual") {
      throw new ActionError(
        `Este movimiento se genera automáticamente (${TRANSACTION_SOURCE_LABELS[existing.sourceType].toLowerCase()}). Elimínalo desde su origen.`,
      );
    }
    await db.delete(transactions).where(and(eq(transactions.id, transactionId), eq(transactions.companyId, company.id)));
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Movimiento eliminado" };
  });
}
