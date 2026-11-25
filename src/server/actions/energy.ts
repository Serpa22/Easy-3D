"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { ActionResult, ActionState } from "@/lib/action";
import { ELECTRICITY_MODES } from "@/lib/domain";
import { zCents, zDate, zDecimal, zId, zOptionalDecimal, zOptionalId, zOptionalText } from "@/lib/validation";
import { ActionError, parseForm, parseInput, runAction } from "@/server/action";
import { requireCompany } from "@/server/context";
import { companies, energyBills } from "@/server/db/schema";
import { removeEnergyBillExpense, syncEnergyBillExpense } from "@/server/domain/derived-expenses";

const price = () => zDecimal({ min: 0, max: 2 });
const tariffSchema = z.object({ electricityMode: z.enum(ELECTRICITY_MODES), kwhPrice: price(), kwhPricePeak: price(), kwhPriceFlat: price(), kwhPriceValley: price() });

/** Cambia la tarifa eléctrica. Solo afecta a las impresiones futuras. */
export async function saveTariffAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const input = parseForm(tariffSchema, formData);
    await db.update(companies).set(input).where(eq(companies.id, company.id));
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Tarifa actualizada" };
  });
}

const billSchema = z
  .object({
    id: zOptionalId(),
    periodStart: zDate(),
    periodEnd: zDate(),
    kwh: zOptionalDecimal(0, { min: 0, max: 10_000_000 }),
    amount: zCents({ min: 1 }),
    provider: zOptionalText(120),
    note: zOptionalText(300),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { path: ["periodEnd"], message: "No puede ser anterior al inicio" });

export async function saveEnergyBillAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const { id, amount, kwh, ...input } = parseForm(billSchema, formData);
    const values = { ...input, kwh: kwh ?? 0, amountCents: amount };
    await db.transaction(async (tx) => {
      const [bill] = id
        ? await tx.update(energyBills).set(values).where(and(eq(energyBills.id, id), eq(energyBills.companyId, company.id))).returning()
        : await tx.insert(energyBills).values({ ...values, companyId: company.id }).returning();
      if (!bill) throw new ActionError("La factura ya no existe.");
      await syncEnergyBillExpense(tx, bill);
    });
    revalidatePath(`/e/${slug}`, "layout");
    return { message: id ? "Factura actualizada" : "Factura registrada" };
  });
}

export async function deleteEnergyBillAction(slug: string, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    await db.transaction(async (tx) => {
      const [bill] = await tx.delete(energyBills).where(and(eq(energyBills.id, parseInput(zId(), id)), eq(energyBills.companyId, company.id))).returning({ id: energyBills.id, companyId: energyBills.companyId });
      if (!bill) throw new ActionError("La factura ya no existe.");
      await removeEnergyBillExpense(tx, bill);
    });
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Factura eliminada" };
  });
}
