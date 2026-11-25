"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult, ActionState } from "@/lib/action";
import { todayISO } from "@/lib/dates";
import { SHIPMENT_STATUSES } from "@/lib/domain";
import { zId } from "@/lib/validation";
import { parseForm, parseInput, runAction } from "@/server/action";
import { requireCompany } from "@/server/context";
import { deleteShipment, saveShipment, setShipmentStatus, shipmentInputSchema } from "@/server/domain/shipments-service";

export async function saveShipmentAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db, org } = await requireCompany(slug);
    const input = parseForm(shipmentInputSchema, formData);
    await saveShipment(db, company.id, input, todayISO(org.timeZone));
    revalidatePath(`/e/${slug}`, "layout");
    return { message: input.id ? "Envío actualizado" : "Envío creado" };
  });
}

export async function setShipmentStatusAction(slug: string, id: string, status: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db, org } = await requireCompany(slug);
    await setShipmentStatus(db, company.id, parseInput(zId(), id), z.enum(SHIPMENT_STATUSES).parse(status), todayISO(org.timeZone));
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Envío actualizado" };
  });
}

export async function deleteShipmentAction(slug: string, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    await deleteShipment(db, company.id, parseInput(zId(), id));
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Envío eliminado" };
  });
}
