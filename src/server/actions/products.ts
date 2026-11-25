"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { ActionResult, ActionState } from "@/lib/action";
import { zCents, zCheckbox, zId, zInt, zOptionalCents, zOptionalDecimal, zOptionalId, zOptionalInt, zOptionalText, zText } from "@/lib/validation";
import { ActionError, parseForm, parseInput, runAction } from "@/server/action";
import { requireCompany } from "@/server/context";
import { machines, materials, products } from "@/server/db/schema";

const productSchema = z.object({
  id: zOptionalId(),
  name: zText(120),
  sku: zOptionalText(60),
  category: zOptionalText(60),
  description: zOptionalText(2000),
  price: zCents(),
  materialId: zOptionalId(),
  materialQty: zOptionalDecimal(0, { min: 0, max: 1_000_000 }),
  printMinutes: zOptionalDecimal(0, { min: 0, max: 100_000 }),
  laborMinutes: zOptionalDecimal(0, { min: 0, max: 100_000 }),
  packagingCost: zOptionalCents(0),
  otherCost: zOptionalCents(0),
  machineId: zOptionalId(),
  stockQty: zOptionalInt(0, { min: 0, max: 10_000_000 }),
  lowStockThreshold: zOptionalInt(0, { min: 0, max: 10_000_000 }),
  active: zCheckbox(),
});

export async function saveProductAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const { id, price, packagingCost, otherCost, ...input } = parseForm(productSchema, formData);
    if (input.materialId) {
      const [m] = await db.select({ id: materials.id }).from(materials).where(and(eq(materials.id, input.materialId), eq(materials.companyId, company.id), isNull(materials.archivedAt))).limit(1);
      if (!m) throw new ActionError("Revisa los campos marcados.", { materialId: "Material no válido" });
    }
    if (input.machineId) {
      const [m] = await db.select({ id: machines.id }).from(machines).where(and(eq(machines.id, input.machineId), eq(machines.companyId, company.id))).limit(1);
      if (!m) throw new ActionError("Revisa los campos marcados.", { machineId: "Máquina no válida" });
    }
    const values = {
      ...input,
      priceCents: price,
      packagingCostCents: packagingCost ?? 0,
      otherCostCents: otherCost ?? 0,
      materialQty: input.materialQty ?? 0,
      printMinutes: input.printMinutes ?? 0,
      laborMinutes: input.laborMinutes ?? 0,
      stockQty: input.stockQty ?? 0,
      lowStockThreshold: input.lowStockThreshold ?? 0,
    };
    let productId = id;
    if (id) {
      const updated = await db.update(products).set(values).where(and(eq(products.id, id), eq(products.companyId, company.id))).returning({ id: products.id });
      if (updated.length === 0) throw new ActionError("El producto ya no existe.");
    } else {
      const [row] = await db.insert(products).values({ ...values, companyId: company.id }).returning({ id: products.id });
      productId = row.id;
    }
    revalidatePath(`/e/${slug}`, "layout");
    return { message: id ? "Producto actualizado" : "Producto creado", data: { id: productId! } };
  });
}

const stockSchema = z.object({ productId: z.uuid(), delta: zInt({ min: -1_000_000, max: 1_000_000 }) });

/** Suma o resta unidades al stock de producto terminado (nunca por debajo de 0). */
export async function adjustProductStockAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const input = parseForm(stockSchema, formData);
    if (input.delta === 0) throw new ActionError("Revisa los campos marcados.", { delta: "Indica cuántas unidades sumar o restar" });
    const updated = await db
      .update(products)
      .set({ stockQty: sql`greatest(${products.stockQty} + ${input.delta}, 0)` })
      .where(and(eq(products.id, input.productId), eq(products.companyId, company.id)))
      .returning({ id: products.id });
    if (updated.length === 0) throw new ActionError("El producto ya no existe.");
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Stock actualizado" };
  });
}

export async function setProductActiveAction(slug: string, id: string, active: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const updated = await db.update(products).set({ active: Boolean(active) }).where(and(eq(products.id, parseInput(zId(), id)), eq(products.companyId, company.id))).returning({ id: products.id });
    if (updated.length === 0) throw new ActionError("El producto ya no existe.");
    revalidatePath(`/e/${slug}`, "layout");
    return { message: active ? "Producto activado" : "Producto desactivado" };
  });
}

export async function duplicateProductAction(slug: string, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const [source] = await db.select().from(products).where(and(eq(products.id, parseInput(zId(), id)), eq(products.companyId, company.id))).limit(1);
    if (!source) throw new ActionError("El producto ya no existe.");
    const { id: _id, createdAt: _createdAt, ...rest } = source;
    void _id;
    void _createdAt;
    const [copy] = await db.insert(products).values({ ...rest, name: `${source.name} (copia)`.slice(0, 120), sku: null, stockQty: 0, active: false }).returning({ id: products.id });
    revalidatePath(`/e/${slug}`, "layout");
    redirect(`/e/${slug}/productos/${copy.id}`);
  });
}

export async function deleteProductAction(slug: string, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const deleted = await db.delete(products).where(and(eq(products.id, parseInput(zId(), id)), eq(products.companyId, company.id))).returning({ id: products.id });
    if (deleted.length === 0) throw new ActionError("El producto ya no existe.");
    revalidatePath(`/e/${slug}`, "layout");
    redirect(`/e/${slug}/productos`);
  });
}
