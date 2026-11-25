/**
 * Existencias de material: todo cambio de stock pasa por un movimiento.
 *
 * El stock es SIEMPRE la suma exacta de sus movimientos, así que puede quedar en
 * negativo (se ha consumido más de lo que consta comprado). No se recorta a 0:
 * recortar perdería información y al deshacer o corregir un movimiento el stock
 * dejaría de cuadrar. La interfaz avisa cuando un material está en negativo.
 */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { materialMovements, materials, type Material } from "@/server/db/schema";
import type { MovementType } from "@/lib/domain";
import { ActionError } from "@/server/action";
import { removeLedgerEntry, syncLedgerEntry } from "./ledger";

export interface MovementInput {
  companyId: string;
  materialId: string;
  type: MovementType;
  /**
   * Cantidad en la unidad del material. El signo lo decide el tipo:
   * compra suma; consumo y merma restan; en «ajuste» se respeta el signo dado.
   */
  qty: number;
  /** 'YYYY-MM-DD' */
  date: string;
  note?: string | null;
  printJobId?: string | null;
  /** Solo compras: coste total (IVA incluido). Genera un gasto en finanzas. */
  totalCostCents?: number | null;
  /** Solo compras: proveedor (para el gasto). */
  supplier?: string | null;
  vatRatePct?: number;
}

function signedQty(type: MovementType, qty: number): number {
  const abs = Math.abs(qty);
  if (type === "purchase") return abs;
  if (type === "consumption" || type === "waste") return -abs;
  return qty;
}

/**
 * Registra un movimiento y actualiza el stock del material (dentro de la
 * transacción que se le pase). Las compras con coste crean su gasto asociado.
 */
export async function applyMaterialMovement(tx: DbOrTx, input: MovementInput): Promise<{ movementId: string; material: Material }> {
  const found = await tx
    .select()
    .from(materials)
    .where(and(eq(materials.id, input.materialId), eq(materials.companyId, input.companyId)))
    .limit(1);
  const material = found[0];
  if (!material) throw new ActionError("El material no existe.");

  const qty = signedQty(input.type, input.qty);
  if (!Number.isFinite(qty) || qty === 0) throw new ActionError("La cantidad debe ser distinta de cero.");

  const [movement] = await tx
    .insert(materialMovements)
    .values({
      companyId: input.companyId,
      materialId: input.materialId,
      type: input.type,
      qty,
      totalCostCents: input.type === "purchase" ? (input.totalCostCents ?? null) : null,
      printJobId: input.printJobId ?? null,
      date: input.date,
      note: input.note ?? null,
    })
    .returning({ id: materialMovements.id });

  const patch: Partial<typeof materials.$inferInsert> = {};
  // Una compra con coste actualiza el precio de referencia del envase.
  if (input.type === "purchase" && input.totalCostCents && input.totalCostCents > 0 && material.packSize > 0) {
    patch.packCostCents = Math.round((input.totalCostCents / qty) * material.packSize);
  }
  const [updated] = await tx
    .update(materials)
    .set({ ...patch, stockQty: sql`${materials.stockQty} + ${qty}` })
    .where(eq(materials.id, material.id))
    .returning();

  if (input.type === "purchase" && input.totalCostCents && input.totalCostCents > 0) {
    await syncLedgerEntry(tx, {
      companyId: input.companyId,
      sourceType: "material_purchase",
      sourceId: movement.id,
      type: "expense",
      category: material.kind === "packaging" ? "packaging" : "materials",
      amountCents: input.totalCostCents,
      vatRatePct: input.vatRatePct,
      date: input.date,
      description: `Compra de ${material.name}`,
      counterparty: input.supplier ?? material.supplier,
    });
  }

  return { movementId: movement.id, material: updated };
}

/** Deshace un movimiento: revierte el stock y borra su gasto asociado. */
export async function revertMaterialMovement(tx: DbOrTx, companyId: string, movementId: string): Promise<void> {
  const found = await tx
    .select()
    .from(materialMovements)
    .where(and(eq(materialMovements.id, movementId), eq(materialMovements.companyId, companyId)))
    .limit(1);
  const movement = found[0];
  if (!movement) throw new ActionError("El movimiento no existe.");
  await tx
    .update(materials)
    .set({ stockQty: sql`${materials.stockQty} - ${movement.qty}` })
    .where(and(eq(materials.id, movement.materialId), eq(materials.companyId, companyId)));
  await removeLedgerEntry(tx, { companyId, sourceType: "material_purchase", sourceId: movement.id });
  await tx.delete(materialMovements).where(eq(materialMovements.id, movement.id));
}

/** Coste de una cantidad de material según el precio de su envase. */
export function materialCostCents(material: Pick<Material, "packCostCents" | "packSize">, qty: number): number {
  if (!material.packSize || material.packSize <= 0) return 0;
  return Math.round((Math.abs(qty) / material.packSize) * material.packCostCents);
}
