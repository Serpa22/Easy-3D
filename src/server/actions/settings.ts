"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import type { ActionResult, ActionState } from "@/lib/action";
import { USER_ROLES } from "@/lib/domain";
import { zDecimal, zId, zOptionalText, zText } from "@/lib/validation";
import { zCents } from "@/lib/validation";
import { ActionError, parseForm, parseInput, runAction } from "@/server/action";
import { SESSION_COOKIE, hashToken, requireOwner, requireUser } from "@/server/auth/session";
import { requireCompany } from "@/server/context";
import { getDb } from "@/server/db";
import { companies, machines } from "@/server/db/schema";
import { createUser, deleteUser, setUserRole, updateOwnAccount } from "@/server/domain/users-service";
import { notifyMachineChanged } from "@/server/printers";
import { createBridge, deleteBridge } from "@/server/printers/bridges";
import { saveOrgSettings } from "@/server/settings";

/* ------------------------- Ajustes de la sub-empresa ------------------------- */

const companySchema = z.object({
  name: zText(80),
  activity: zOptionalText(120),
  description: zOptionalText(500),
  monogram: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,3}$/, "De 1 a 3 letras o números"),
  orderPrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,5}$/, "De 1 a 5 letras o números"),
});

export async function saveCompanyAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    await db.update(companies).set(parseForm(companySchema, formData)).where(eq(companies.id, company.id));
    revalidatePath("/", "layout");
    return { message: "Datos de la empresa guardados" };
  });
}

const paramsSchema = z.object({
  vatRatePct: zDecimal({ min: 0, max: 100 }),
  laborRate: zCents(),
  targetMarginPct: zDecimal({ min: 0, max: 95 }),
  failureRatePct: zDecimal({ min: 0, max: 90 }),
});

export async function saveCompanyParamsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const { laborRate, ...input } = parseForm(paramsSchema, formData);
    await db.update(companies).set({ ...input, laborRateCents: laborRate }).where(eq(companies.id, company.id));
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Parámetros guardados" };
  });
}

export async function archiveCompanyAction(slug: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    await requireOwner();
    await db.update(companies).set({ archivedAt: new Date() }).where(eq(companies.id, company.id));
    revalidatePath("/", "layout");
    redirect("/");
  });
}

export async function restoreCompanyAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await requireOwner();
    const db = await getDb();
    await db.update(companies).set({ archivedAt: null }).where(eq(companies.id, parseInput(zId(), id)));
    revalidatePath("/", "layout");
    return { message: "Sub-empresa recuperada" };
  });
}

/** Elimina definitivamente la sub-empresa y todos sus datos. Exige escribir su nombre. */
export async function deleteCompanyAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    await requireOwner();
    const typed = String(formData.get("confirm") ?? "").trim();
    if (typed !== company.name) throw new ActionError("Revisa los campos marcados.", { confirm: "Escribe el nombre exacto de la sub-empresa" });
    // Se retiran primero las conexiones de sus máquinas para que el gestor las cierre.
    await db.update(machines).set({ connectionType: "none" }).where(and(eq(machines.companyId, company.id), ne(machines.connectionType, "none")));
    await notifyMachineChanged();
    await db.delete(companies).where(eq(companies.id, company.id));
    revalidatePath("/", "layout");
    redirect("/");
  });
}

/* ------------------------------ Ajustes globales ------------------------------ */

const orgSchema = z.object({
  orgName: zText(80),
  timeZone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("es-ES", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Zona horaria no válida"),
});

export async function saveOrgAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await requireOwner();
    await saveOrgSettings(parseForm(orgSchema, formData));
    revalidatePath("/", "layout");
    return { message: "Organización actualizada" };
  });
}

const zPassword = z.string().min(8, "Mínimo 8 caracteres").max(200);
const userSchema = z.object({ name: zText(80), email: z.string().trim().toLowerCase().pipe(z.email("Correo no válido")), password: zPassword, role: z.enum(USER_ROLES) });

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await requireOwner();
    await createUser(await getDb(), parseForm(userSchema, formData));
    revalidatePath("/ajustes");
    return { message: "Usuario creado" };
  });
}

export async function setUserRoleAction(userId: string, role: string): Promise<ActionResult> {
  return runAction(async () => {
    await requireOwner();
    await setUserRole(await getDb(), parseInput(zId(), userId), z.enum(USER_ROLES).parse(role));
    revalidatePath("/ajustes");
    return { message: "Rol actualizado" };
  });
}

export async function deleteUserAction(userId: string): Promise<ActionResult> {
  return runAction(async () => {
    const owner = await requireOwner();
    await deleteUser(await getDb(), owner.id, parseInput(zId(), userId));
    revalidatePath("/ajustes");
    return { message: "Usuario eliminado" };
  });
}

const accountSchema = z
  .object({ name: zText(80), currentPassword: zOptionalText(200), newPassword: z.preprocess((v) => (v === "" ? undefined : v), zPassword.optional()) })
  .refine((v) => !v.newPassword || Boolean(v.currentPassword), { path: ["currentPassword"], message: "Introduce tu contraseña actual" });

export async function updateAccountAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const input = parseForm(accountSchema, formData);
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    await updateOwnAccount(await getDb(), user.id, token ? hashToken(token) : null, input);
    revalidatePath("/", "layout");
    return { message: input.newPassword ? "Contraseña cambiada. Se han cerrado tus otras sesiones." : "Cuenta actualizada" };
  });
}

/** Crea un bridge y devuelve su token (solo se muestra esta vez). */
export async function createBridgeAction(_prev: ActionState, formData: FormData): Promise<ActionResult<{ token: string }>> {
  return runAction(async () => {
    await requireOwner();
    const { name } = parseForm(z.object({ name: zText(80) }), formData);
    const { token } = await createBridge(await getDb(), name);
    revalidatePath("/ajustes");
    return { data: { token } };
  });
}

export async function deleteBridgeAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await requireOwner();
    await deleteBridge(await getDb(), parseInput(zId(), id));
    await notifyMachineChanged();
    revalidatePath("/ajustes");
    return { message: "Bridge eliminado" };
  });
}
