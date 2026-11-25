"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action";
import { runAction } from "@/server/action";
import { requireOwner } from "@/server/auth/session";
import { removeDemoData, seedDemoData } from "@/server/demo/seed";
import { notifyMachineChanged } from "@/server/printers";

/** Crea las sub-empresas de demostración (solo el propietario). */
export async function seedDemoAction(): Promise<ActionResult> {
  return runAction(async () => {
    await requireOwner();
    await seedDemoData();
    await notifyMachineChanged("*");
    revalidatePath("/", "layout");
    return { message: "Datos de ejemplo creados" };
  });
}

/** Borra las sub-empresas de demostración (solo las creadas por el generador). */
export async function removeDemoAction(): Promise<ActionResult> {
  return runAction(async () => {
    await requireOwner();
    const removed = await removeDemoData();
    await notifyMachineChanged("*");
    revalidatePath("/", "layout");
    return { message: removed > 0 ? "Datos de ejemplo eliminados" : "No había datos de ejemplo que eliminar" };
  });
}
