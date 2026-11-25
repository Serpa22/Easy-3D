"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult, ActionState } from "@/lib/action";
import { zCheckbox, zOptionalText, zText } from "@/lib/validation";
import { ActionError, parseForm, runAction } from "@/server/action";
import { getDb } from "@/server/db";
import { users } from "@/server/db/schema";
import { count } from "@/server/db/sql";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { rateLimit, resetRateLimit } from "@/server/auth/rate-limit";
import { createSession, destroySession } from "@/server/auth/session";
import { findUserByEmail, normalizeEmail } from "@/server/auth/users";
import { createCompany } from "@/server/domain/companies";
import { saveOrgSettings } from "@/server/settings";

const zEmail = z
  .string({ error: "Introduce tu correo" })
  .trim()
  .toLowerCase()
  .pipe(z.email("Correo no válido"));

const zPassword = z
  .string({ error: "Introduce una contraseña" })
  .min(8, "Mínimo 8 caracteres")
  .max(200, "Máximo 200 caracteres");

const loginSchema = z.object({
  email: zEmail,
  password: z.string({ error: "Introduce tu contraseña" }).min(1, "Introduce tu contraseña"),
});

// Hash de relleno para que el tiempo de respuesta no delate si el correo existe.
const DUMMY_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const input = parseForm(loginSchema, formData);
    const ip = await clientIp();
    const keys = [`login:ip:${ip}`, `login:email:${input.email}`];
    const limits = [rateLimit(keys[0], 30, 15 * 60_000), rateLimit(keys[1], 8, 15 * 60_000)];
    const blocked = limits.find((l) => !l.allowed);
    if (blocked) {
      throw new ActionError(
        `Demasiados intentos. Vuelve a probar en ${Math.max(1, Math.ceil(blocked.retryAfterSec / 60))} min.`,
      );
    }

    const user = await findUserByEmail(input.email);
    const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) throw new ActionError("Correo o contraseña incorrectos.");

    resetRateLimit(keys[1]);
    await createSession(user.id);
    redirect("/");
  });
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

const setupSchema = z.object({
  orgName: zText(80),
  name: zText(80),
  email: zEmail,
  password: zPassword,
  companyName: zOptionalText(80),
  companyActivity: zOptionalText(120),
  demo: zCheckbox(),
});

/** Primer arranque: crea la cuenta de propietario, la organización y (opcional) la primera sub-empresa. */
export async function setupAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const input = parseForm(setupSchema, formData);
    const db = await getDb();
    const passwordHash = await hashPassword(input.password);

    const result = await db.transaction(async (tx) => {
      const [{ n }] = await tx.select({ n: count() }).from(users);
      if (n > 0) throw new ActionError("La aplicación ya está configurada. Inicia sesión.");
      const [user] = await tx
        .insert(users)
        .values({ email: normalizeEmail(input.email), name: input.name, passwordHash, role: "owner" })
        .returning({ id: users.id });
      const company = input.companyName
        ? await createCompany(tx, { name: input.companyName, activity: input.companyActivity })
        : null;
      return { userId: user.id, companySlug: company?.slug ?? null };
    });

    await saveOrgSettings({ orgName: input.orgName });
    await createSession(result.userId);

    if (input.demo) {
      // Los datos de ejemplo son opcionales: si fallan no deben impedir entrar.
      try {
        const { seedDemoData } = await import("@/server/demo/seed");
        await seedDemoData();
      } catch (error) {
        console.error("[setup] no se pudieron crear los datos de ejemplo", error);
      }
      redirect("/");
    }
    redirect(result.companySlug ? `/e/${result.companySlug}` : "/");
  });
}
