"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { ActionResult, ActionState } from "@/lib/action";
import { mergeConnectionConfig } from "@/lib/connections";
import { todayISO } from "@/lib/dates";
import { CONNECTION_TYPES, MACHINE_STATUSES, MAINTENANCE_TYPES, TECHNOLOGIES } from "@/lib/domain";
import { zCheckbox, zDate, zId, zInt, zOptionalCents, zOptionalDate, zOptionalDecimal, zOptionalId, zOptionalText, zText } from "@/lib/validation";
import { ActionError, formToObject, parseForm, parseInput, runAction } from "@/server/action";
import { requireCompany } from "@/server/context";
import { bridges, machines, maintenanceLogs, materials, transactions } from "@/server/db/schema";
import { removeMaintenanceExpense, syncMachinePurchaseExpense, syncMaintenanceExpense } from "@/server/domain/derived-expenses";
import { notifyMachineChanged, testConnection, type ConnectionTestResult } from "@/server/printers";

const machineSchema = z.object({
  id: zOptionalId(),
  name: zText(80),
  brand: zOptionalText(60),
  model: zOptionalText(60),
  technology: z.enum(TECHNOLOGIES),
  serialNumber: zOptionalText(80),
  location: zOptionalText(80),
  status: z.enum(MACHINE_STATUSES),
  notes: zOptionalText(2000),
  powerPrintW: zOptionalDecimal(120, { min: 0, max: 20000 }),
  powerIdleW: zOptionalDecimal(8, { min: 0, max: 20000 }),
  purchasePrice: zOptionalCents(null),
  purchaseDate: zOptionalDate(),
  lifespanHours: zInt({ min: 1, max: 200000 }),
  registerPurchase: zCheckbox(),
  loadedMaterialId: zOptionalId(),
  connectionType: z.enum(CONNECTION_TYPES),
  bridgeId: zOptionalId(),
});

/** Extrae los campos de conexión (`conn_<clave>`) del formulario. */
function connectionInput(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(formToObject(formData))) {
    if (key.startsWith("conn_")) out[key.slice(5)] = value;
  }
  return out;
}

function prefixErrors(errors: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).map(([k, v]) => [`conn_${k}`, v]));
}

/** Crea o edita una máquina (datos, consumo, amortización y conexión en directo). */
export async function saveMachineAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db, org } = await requireCompany(slug);
    const input = parseForm(machineSchema, formData);
    if (input.purchaseDate && input.purchaseDate > todayISO(org.timeZone)) throw new ActionError("Revisa los campos marcados.", { purchaseDate: "No puede ser una fecha futura" });

    const machineId = await db.transaction(async (tx) => {
      const [existing] = input.id
        ? await tx.select().from(machines).where(and(eq(machines.id, input.id), eq(machines.companyId, company.id))).limit(1)
        : [];
      if (input.id && !existing) throw new ActionError("La máquina ya no existe.");

      if (input.loadedMaterialId) {
        const [material] = await tx
          .select({ id: materials.id })
          .from(materials)
          .where(and(eq(materials.id, input.loadedMaterialId), eq(materials.companyId, company.id), isNull(materials.archivedAt)))
          .limit(1);
        if (!material) throw new ActionError("Revisa los campos marcados.", { loadedMaterialId: "Material no válido" });
      }
      if (input.bridgeId) {
        const [bridge] = await tx.select({ id: bridges.id }).from(bridges).where(eq(bridges.id, input.bridgeId)).limit(1);
        if (!bridge) throw new ActionError("Revisa los campos marcados.", { bridgeId: "Bridge no válido" });
      }

      const merged = mergeConnectionConfig(
        input.connectionType,
        connectionInput(formData),
        existing ? { type: existing.connectionType, config: existing.connectionConfig ?? {} } : null,
      );
      if (Object.keys(merged.errors).length > 0) throw new ActionError("Faltan datos de la conexión.", prefixErrors(merged.errors));

      const values = {
        name: input.name,
        brand: input.brand,
        model: input.model,
        technology: input.technology,
        serialNumber: input.serialNumber,
        location: input.location,
        status: input.status,
        notes: input.notes,
        powerPrintW: input.powerPrintW ?? 120,
        powerIdleW: input.powerIdleW ?? 8,
        purchasePriceCents: input.purchasePrice,
        purchaseDate: input.purchaseDate,
        lifespanHours: input.lifespanHours,
        loadedMaterialId: input.loadedMaterialId,
        connectionType: input.connectionType,
        connectionConfig: merged.config,
        bridgeId: input.connectionType === "none" || input.connectionType === "simulator" ? null : input.bridgeId,
      };
      const [row] = existing
        ? await tx.update(machines).set(values).where(eq(machines.id, existing.id)).returning()
        : await tx.insert(machines).values({ ...values, companyId: company.id }).returning();
      await syncMachinePurchaseExpense(tx, row, input.registerPurchase);
      return row.id;
    });

    await notifyMachineChanged(machineId);
    revalidatePath(`/e/${slug}`, "layout");
    return { message: input.id ? "Máquina actualizada" : "Máquina añadida", data: { id: machineId } };
  });
}

/** Prueba la conexión con los datos del formulario (sin guardar). */
export async function testConnectionAction(slug: string, formData: FormData): Promise<ActionResult<ConnectionTestResult>> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const type = z.enum(CONNECTION_TYPES).parse(formData.get("connectionType"));
    const id = zOptionalId().parse(formData.get("id") ?? "");
    const [existing] = id
      ? await db.select().from(machines).where(and(eq(machines.id, id), eq(machines.companyId, company.id))).limit(1)
      : [];
    const merged = mergeConnectionConfig(type, connectionInput(formData), existing ? { type: existing.connectionType, config: existing.connectionConfig ?? {} } : null);
    if (Object.keys(merged.errors).length > 0) throw new ActionError("Faltan datos de la conexión.", prefixErrors(merged.errors));
    const technology = String(formData.get("technology") ?? "fdm");
    const result = await testConnection(type, merged.config, { technology });
    return { data: result };
  });
}

/** Elimina una máquina. El historial de impresiones se conserva sin referencia a ella. */
export async function deleteMachineAction(slug: string, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const machineId = parseInput(zId(), id);
    await db.transaction(async (tx) => {
      const [machine] = await tx.select({ id: machines.id }).from(machines).where(and(eq(machines.id, machineId), eq(machines.companyId, company.id))).limit(1);
      if (!machine) throw new ActionError("La máquina ya no existe.");
      // Sus gastos (compra y mantenimientos) son hechos pasados: se conservan en Finanzas,
      // pero pasan a ser movimientos manuales para que se puedan seguir editando.
      const logs = await tx.select({ id: maintenanceLogs.id }).from(maintenanceLogs).where(and(eq(maintenanceLogs.machineId, machineId), eq(maintenanceLogs.companyId, company.id)));
      const sourceIds = [machineId, ...logs.map((l) => l.id)];
      await tx
        .update(transactions)
        .set({ sourceType: "manual", sourceId: null, sourceKey: "" })
        .where(and(eq(transactions.companyId, company.id), inArray(transactions.sourceType, ["machine", "maintenance"]), inArray(transactions.sourceId, sourceIds)));
      await tx.delete(machines).where(eq(machines.id, machineId));
    });
    await notifyMachineChanged(machineId);
    revalidatePath(`/e/${slug}`, "layout");
    redirect(`/e/${slug}/maquinas`);
  });
}

const maintenanceSchema = z.object({
  id: zOptionalId(),
  date: zDate(),
  type: z.enum(MAINTENANCE_TYPES),
  title: zText(120),
  description: zOptionalText(2000),
  cost: zOptionalCents(0),
  nextDueDate: zOptionalDate(),
});

export async function saveMaintenanceAction(slug: string, machineId: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const input = parseForm(maintenanceSchema, formData);
    await db.transaction(async (tx) => {
      const [machine] = await tx
        .select({ id: machines.id, name: machines.name })
        .from(machines)
        .where(and(eq(machines.id, parseInput(zId(), machineId)), eq(machines.companyId, company.id)))
        .limit(1);
      if (!machine) throw new ActionError("La máquina ya no existe.");
      const values = {
        date: input.date,
        type: input.type,
        title: input.title,
        description: input.description,
        costCents: input.cost ?? 0,
        nextDueDate: input.nextDueDate,
      };
      const [log] = input.id
        ? await tx
            .update(maintenanceLogs)
            .set(values)
            .where(and(eq(maintenanceLogs.id, input.id), eq(maintenanceLogs.companyId, company.id), eq(maintenanceLogs.machineId, machine.id)))
            .returning()
        : await tx.insert(maintenanceLogs).values({ ...values, companyId: company.id, machineId: machine.id }).returning();
      if (!log) throw new ActionError("El registro ya no existe.");
      await syncMaintenanceExpense(tx, log, machine.name);
    });
    revalidatePath(`/e/${slug}`, "layout");
    return { message: input.id ? "Mantenimiento actualizado" : "Mantenimiento registrado" };
  });
}

export async function deleteMaintenanceAction(slug: string, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const logId = parseInput(zId(), id);
    await db.transaction(async (tx) => {
      const [log] = await tx
        .delete(maintenanceLogs)
        .where(and(eq(maintenanceLogs.id, logId), eq(maintenanceLogs.companyId, company.id)))
        .returning({ id: maintenanceLogs.id, companyId: maintenanceLogs.companyId });
      if (!log) throw new ActionError("El registro ya no existe.");
      await removeMaintenanceExpense(tx, log);
    });
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Registro eliminado" };
  });
}
