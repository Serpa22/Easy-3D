"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { ActionResult, ActionState } from "@/lib/action";
import { todayISO } from "@/lib/dates";
import { EXPENSE_CATEGORIES, RECURRING_FREQUENCIES } from "@/lib/domain";
import { zCents, zCheckbox, zDate, zId, zOptionalDate, zOptionalDecimal, zOptionalId, zOptionalText, zText } from "@/lib/validation";
import { ActionError, parseForm, parseInput, runAction } from "@/server/action";
import { requireCompany } from "@/server/context";
import { recurringExpenses } from "@/server/db/schema";
import { saveRecurring, setRecurringActive } from "@/server/domain/recurring";

const schema = z
  .object({
    id: zOptionalId(),
    name: zText(120),
    category: z.enum(EXPENSE_CATEGORIES),
    amount: zCents({ min: 1 }),
    vatRatePct: zOptionalDecimal(21, { min: 0, max: 100 }),
    frequency: z.enum(RECURRING_FREQUENCIES),
    startDate: zDate(),
    endDate: zOptionalDate(),
    counterparty: zOptionalText(120),
    active: zCheckbox(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { path: ["endDate"], message: "No puede ser anterior al primer cargo" });

export async function saveRecurringAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db, org } = await requireCompany(slug);
    const { id, amount, ...input } = parseForm(schema, formData);
    const { created } = await db.transaction((tx) =>
      saveRecurring(tx, company.id, id, { ...input, amountCents: amount, vatRatePct: input.vatRatePct ?? 21 }, todayISO(org.timeZone)),
    );
    revalidatePath(`/e/${slug}`, "layout");
    return { message: `${id ? "Gasto recurrente actualizado" : "Gasto recurrente creado"}${created > 0 ? ` · ${created} ${created === 1 ? "cargo generado" : "cargos generados"}` : ""}` };
  });
}

export async function setRecurringActiveAction(slug: string, id: string, active: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db, org } = await requireCompany(slug);
    await db.transaction((tx) => setRecurringActive(tx, company.id, parseInput(zId(), id), Boolean(active), todayISO(org.timeZone)));
    revalidatePath(`/e/${slug}`, "layout");
    return { message: active ? "Gasto reanudado: los meses en pausa no se cobran" : "Gasto en pausa" };
  });
}

export async function deleteRecurringAction(slug: string, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const deleted = await db.delete(recurringExpenses).where(and(eq(recurringExpenses.id, parseInput(zId(), id)), eq(recurringExpenses.companyId, company.id))).returning({ id: recurringExpenses.id });
    if (deleted.length === 0) throw new ActionError("El gasto recurrente ya no existe.");
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Gasto recurrente eliminado" };
  });
}
