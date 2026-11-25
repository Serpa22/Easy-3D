"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { ActionResult, ActionState } from "@/lib/action";
import { todayISO } from "@/lib/dates";
import { MATERIAL_KINDS, MATERIAL_UNITS } from "@/lib/domain";
import { zCents, zDate, zDecimal, zId, zOptionalCents, zOptionalColor, zOptionalDecimal, zOptionalId, zOptionalText, zText } from "@/lib/validation";
import { ActionError, parseForm, parseInput, runAction } from "@/server/action";
import { requireCompany } from "@/server/context";
import { machines, materialMovements, materials } from "@/server/db/schema";
import { count } from "@/server/db/sql";
import { applyMaterialMovement, revertMaterialMovement } from "@/server/domain/stock";

const materialSchema = z.object({
  id: zOptionalId(),
  name: zText(120),
  kind: z.enum(MATERIAL_KINDS),
  materialType: zOptionalText(60),
  brand: zOptionalText(60),
  colorName: zOptionalText(60),
  colorHex: zOptionalColor(),
  unit: z.enum(MATERIAL_UNITS),
  packSize: zDecimal({ min: 0.001, max: 10_000_000 }),
  packCost: zOptionalCents(0),
  initialStock: zOptionalDecimal(0, { min: 0, max: 100_000_000 }),
  lowStockThreshold: zOptionalDecimal(0, { min: 0, max: 100_000_000 }),
  supplier: zOptionalText(120),
  location: zOptionalText(120),
  notes: zOptionalText(2000),
});

export async function saveMaterialAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db, org } = await requireCompany(slug);
    const { id, initialStock, packCost, ...input } = parseForm(materialSchema, formData);
    const values = { ...input, packCostCents: packCost ?? 0, lowStockThreshold: input.lowStockThreshold ?? 0 };
    await db.transaction(async (tx) => {
      if (id) {
        const [existing] = await tx.select().from(materials).where(and(eq(materials.id, id), eq(materials.companyId, company.id))).limit(1);
        if (!existing) throw new ActionError("El material ya no existe.");
        if (existing.unit !== values.unit) {
          const [{ n }] = await tx.select({ n: count() }).from(materialMovements).where(eq(materialMovements.materialId, id));
          if (n > 0) throw new ActionError("Revisa los campos marcados.", { unit: "No se puede cambiar la unidad de un material con movimientos" });
        }
        await tx.update(materials).set(values).where(eq(materials.id, id));
      } else {
        const [row] = await tx.insert(materials).values({ ...values, companyId: company.id, stockQty: 0 }).returning({ id: materials.id });
        if (initialStock && initialStock > 0) {
          await applyMaterialMovement(tx, { companyId: company.id, materialId: row.id, type: "adjustment", qty: initialStock, date: todayISO(org.timeZone), note: "Stock inicial" });
        }
      }
    });
    revalidatePath(`/e/${slug}`, "layout");
    return { message: id ? "Material actualizado" : "Material añadido" };
  });
}

const purchaseSchema = z.object({
  materialId: z.uuid(),
  packs: zDecimal({ min: 0.001, max: 100000 }),
  totalCost: zCents(),
  date: zDate(),
  supplier: zOptionalText(120),
  vatRatePct: zOptionalDecimal(21, { min: 0, max: 100 }),
  note: zOptionalText(300),
});

/** Registra una compra: suma stock y apunta el gasto en Finanzas. */
export async function purchaseMaterialAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const input = parseForm(purchaseSchema, formData);
    await db.transaction(async (tx) => {
      const [material] = await tx.select({ packSize: materials.packSize }).from(materials).where(and(eq(materials.id, input.materialId), eq(materials.companyId, company.id))).limit(1);
      if (!material) throw new ActionError("El material ya no existe.");
      await applyMaterialMovement(tx, {
        companyId: company.id,
        materialId: input.materialId,
        type: "purchase",
        qty: input.packs * material.packSize,
        totalCostCents: input.totalCost,
        date: input.date,
        supplier: input.supplier,
        vatRatePct: input.vatRatePct ?? 21,
        note: input.note,
      });
    });
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Compra registrada" };
  });
}

const adjustSchema = z.object({ materialId: z.uuid(), realStock: zDecimal({ min: 0, max: 100_000_000 }), note: zOptionalText(300) });

/** Ajusta el stock al recuento real (crea un movimiento de ajuste por la diferencia). */
export async function adjustMaterialAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db, org } = await requireCompany(slug);
    const input = parseForm(adjustSchema, formData);
    const changed = await db.transaction(async (tx) => {
      const [material] = await tx.select({ stockQty: materials.stockQty }).from(materials).where(and(eq(materials.id, input.materialId), eq(materials.companyId, company.id))).limit(1);
      if (!material) throw new ActionError("El material ya no existe.");
      const delta = input.realStock - material.stockQty;
      if (Math.abs(delta) < 1e-9) return false;
      await applyMaterialMovement(tx, { companyId: company.id, materialId: input.materialId, type: "adjustment", qty: delta, date: todayISO(org.timeZone), note: input.note ?? "Recuento de inventario" });
      return true;
    });
    revalidatePath(`/e/${slug}`, "layout");
    return { message: changed ? "Stock ajustado" : "El stock ya coincidía" };
  });
}

const wasteSchema = z.object({ materialId: z.uuid(), qty: zDecimal({ min: 0.001, max: 100_000_000 }), note: zOptionalText(300) });

export async function wasteMaterialAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db, org } = await requireCompany(slug);
    const input = parseForm(wasteSchema, formData);
    await db.transaction((tx) => applyMaterialMovement(tx, { companyId: company.id, materialId: input.materialId, type: "waste", qty: input.qty, date: todayISO(org.timeZone), note: input.note ?? "Merma" }));
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Merma registrada" };
  });
}

/** Deshace un movimiento (no los consumos de impresiones: esos se gestionan desde Impresiones). */
export async function revertMovementAction(slug: string, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const movementId = parseInput(zId(), id);
    await db.transaction(async (tx) => {
      const [movement] = await tx.select({ printJobId: materialMovements.printJobId }).from(materialMovements).where(and(eq(materialMovements.id, movementId), eq(materialMovements.companyId, company.id))).limit(1);
      if (!movement) throw new ActionError("El movimiento ya no existe.");
      if (movement.printJobId) throw new ActionError("Este consumo pertenece a una impresión. Corrígelo desde Impresiones.");
      await revertMaterialMovement(tx, company.id, movementId);
    });
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Movimiento deshecho" };
  });
}

export async function archiveMaterialAction(slug: string, id: string, archived: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const materialId = parseInput(zId(), id);
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(materials)
        .set({ archivedAt: archived ? new Date() : null })
        .where(and(eq(materials.id, materialId), eq(materials.companyId, company.id)))
        .returning({ id: materials.id });
      if (updated.length === 0) throw new ActionError("El material ya no existe.");
      // Un material archivado deja de estar cargado en las máquinas: no debe seguir descontándose.
      if (archived) await tx.update(machines).set({ loadedMaterialId: null }).where(and(eq(machines.loadedMaterialId, materialId), eq(machines.companyId, company.id)));
    });
    revalidatePath(`/e/${slug}`, "layout");
    return { message: archived ? "Material archivado" : "Material recuperado" };
  });
}

export async function deleteMaterialAction(slug: string, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const materialId = parseInput(zId(), id);
    await db.transaction(async (tx) => {
      const [{ n }] = await tx.select({ n: count() }).from(materialMovements).where(and(eq(materialMovements.materialId, materialId), eq(materialMovements.companyId, company.id)));
      if (n > 0) throw new ActionError("Este material tiene movimientos. Archívalo para conservar su historial.");
      // Se descarga de las máquinas que lo tuvieran puesto (la clave foránea también lo garantiza).
      await tx.update(machines).set({ loadedMaterialId: null }).where(and(eq(machines.loadedMaterialId, materialId), eq(machines.companyId, company.id)));
      const deleted = await tx.delete(materials).where(and(eq(materials.id, materialId), eq(materials.companyId, company.id))).returning({ id: materials.id });
      if (deleted.length === 0) throw new ActionError("El material ya no existe.");
    });
    revalidatePath(`/e/${slug}`, "layout");
    redirect(`/e/${slug}/materiales`);
  });
}
