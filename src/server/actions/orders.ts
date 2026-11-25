"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { ActionResult, ActionState } from "@/lib/action";
import { todayISO } from "@/lib/dates";
import { ORDER_STATUSES } from "@/lib/domain";
import { zId, zOptionalId, zOptionalText, zText } from "@/lib/validation";
import { ActionError, parseForm, parseInput, runAction } from "@/server/action";
import { requireCompany } from "@/server/context";
import { customers } from "@/server/db/schema";
import { deleteOrder, orderInputSchema, saveOrder, updateOrderState } from "@/server/domain/orders-service";

/** Crea o edita un pedido a partir del formulario (JSON tipado, importes como texto). */
export async function saveOrderAction(slug: string, payload: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { company, db, org } = await requireCompany(slug);
    const input = parseInput(orderInputSchema, payload);
    const saved = await saveOrder(db, company, input, todayISO(org.timeZone));
    revalidatePath(`/e/${slug}`, "layout");
    return { data: { id: saved.id }, message: input.id ? `Pedido ${saved.number} actualizado` : `Pedido ${saved.number} creado` };
  });
}

export async function setOrderStatusAction(slug: string, id: string, status: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db, org } = await requireCompany(slug);
    await updateOrderState(db, company.id, parseInput(zId(), id), { status: z.enum(ORDER_STATUSES).parse(status) }, todayISO(org.timeZone));
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Estado actualizado" };
  });
}

export async function setOrderPaidAction(slug: string, id: string, paid: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db, org } = await requireCompany(slug);
    await updateOrderState(db, company.id, parseInput(zId(), id), { paid: Boolean(paid) }, todayISO(org.timeZone));
    revalidatePath(`/e/${slug}`, "layout");
    return { message: paid ? "Pedido marcado como cobrado" : "Cobro retirado" };
  });
}

export async function deleteOrderAction(slug: string, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    await deleteOrder(db, company.id, parseInput(zId(), id));
    revalidatePath(`/e/${slug}`, "layout");
    redirect(`/e/${slug}/pedidos`);
  });
}

const customerSchema = z.object({
  id: zOptionalId(),
  name: zText(120),
  email: zOptionalText(160),
  phone: zOptionalText(40),
  taxId: zOptionalText(30),
  addressLine: zOptionalText(200),
  postalCode: zOptionalText(20),
  city: zOptionalText(80),
  province: zOptionalText(80),
  country: zOptionalText(80),
  notes: zOptionalText(2000),
});

export async function saveCustomerAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const { id, ...values } = parseForm(customerSchema, formData);
    if (id) {
      const updated = await db.update(customers).set(values).where(and(eq(customers.id, id), eq(customers.companyId, company.id))).returning({ id: customers.id });
      if (updated.length === 0) throw new ActionError("El cliente ya no existe.");
    } else {
      await db.insert(customers).values({ ...values, companyId: company.id });
    }
    revalidatePath(`/e/${slug}`, "layout");
    return { message: id ? "Cliente actualizado" : "Cliente añadido" };
  });
}

export async function deleteCustomerAction(slug: string, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const deleted = await db.delete(customers).where(and(eq(customers.id, parseInput(zId(), id)), eq(customers.companyId, company.id))).returning({ id: customers.id });
    if (deleted.length === 0) throw new ActionError("El cliente ya no existe.");
    revalidatePath(`/e/${slug}`, "layout");
    redirect(`/e/${slug}/clientes`);
  });
}
