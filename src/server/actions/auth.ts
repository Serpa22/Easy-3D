"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { ActionResult, ActionState } from "@/lib/action";
import { zCheckbox, zOptionalText, zText } from "@/lib/validation";
import { ActionError, parseForm, runAction } from "@/server/action";
import { getDb } from "@/server/db";
import { users } from "@/server/db/schema";
import { count } from "@/server/db/sql";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { TooManyAttemptsError, isBlocked, recordFailure, resetRateLimit, withAccountThrottle } from "@/server/auth/rate-limit";
import { createSession, destroySession } from "@/server/auth/session";
import { findUserByEmail, normalizeEmail } from "@/server/auth/users";
import { createCompany } from "@/server/domain/companies";
import { logError } from "@/server/log";
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

const WINDOW_MS = 15 * 60_000;

/**
 * Dirección del cliente, solo si viene de una fuente fiable.
 *
 * `X-Forwarded-For` lo puede escribir cualquiera salvo que haya un proxy de
 * confianza delante que lo fije. `E3D_TRUST_PROXY` indica cuántos proxies
 * propios hay delante de la app (en Vercel, 1 por defecto). Sin proxy de
 * confianza no se usa la IP para bloquear: un tope por IP falseable solo
 * serviría para dejar fuera a otra persona.
 */
async function trustedClientIp(): Promise<string | null> {
  const configured = process.env.E3D_TRUST_PROXY;
  const hops = configured !== undefined ? Number(configured) : process.env.VERCEL ? 1 : 0;
  if (!Number.isInteger(hops) || hops <= 0) return null;
  const h = await headers();
  const chain = (h.get("x-forwarded-for") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  // Cada proxy añade por la derecha la dirección de quien le habla: la del cliente es la n-ésima por el final.
  return chain[chain.length - hops] ?? null;
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const input = parseForm(loginSchema, formData);
    const ip = await trustedClientIp();
    const ipKey = ip ? `login:ip:${ip}` : null;
    const pairKey = ip ? `login:pair:${ip}:${input.email}` : null;
    const accountKey = `login:account:${input.email}`;
    const tooMany = (retryAfterSec: number) => new ActionError(`Demasiados intentos. Vuelve a probar en ${Math.max(1, Math.ceil(retryAfterSec / 60))} min.`);

    // Topes duros solo con una IP fiable; cuentan únicamente los intentos fallidos.
    for (const [key, limit] of [[pairKey, 8], [ipKey, 30]] as const) {
      if (!key) continue;
      const state = isBlocked(key, limit);
      if (state.blocked) throw tooMany(state.retryAfterSec);
    }

    let userId: string;
    try {
      // Por cuenta: de uno en uno y cada vez más despacio tras varios fallos, sin bloquear al dueño.
      userId = await withAccountThrottle(accountKey, async () => {
        const user = await findUserByEmail(input.email);
        const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !valid) {
          for (const key of [accountKey, pairKey, ipKey]) if (key) recordFailure(key, WINDOW_MS);
          throw new ActionError("Correo o contraseña incorrectos.");
        }
        return user.id;
      });
    } catch (error) {
      if (error instanceof TooManyAttemptsError) throw tooMany(60);
      throw error;
    }

    for (const key of [accountKey, pairKey, ipKey]) if (key) resetRateLimit(key);
    await createSession(userId);
    redirect("/");
  });
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

/** Clave del bloqueo que serializa el primer arranque (un número cualquiera, fijo). */
const SETUP_LOCK = 3_317_001;

/** Comparación en tiempo constante del código de instalación. */
function sameToken(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const setupSchema = z.object({
  setupToken: zOptionalText(200),
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
    // En despliegues abiertos a internet, `E3D_SETUP_TOKEN` evita que otra persona
    // se adelante y cree la cuenta de propietario antes que tú.
    const expected = process.env.E3D_SETUP_TOKEN;
    if (expected && !sameToken(input.setupToken ?? "", expected)) {
      throw new ActionError("Revisa los campos marcados.", { setupToken: "Código de instalación incorrecto" });
    }
    const db = await getDb();
    const passwordHash = await hashPassword(input.password);

    const result = await db.transaction(async (tx) => {
      // Dos altas simultáneas no pueden pasar a la vez la comprobación «aún no hay usuarios».
      await tx.execute(sql`select pg_advisory_xact_lock(${SETUP_LOCK})`);
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
        // Las impresoras simuladas empiezan a informar al momento, sin esperar a la resincronización periódica.
        const { notifyMachineChanged } = await import("@/server/printers");
        await notifyMachineChanged();
      } catch (error) {
        logError("setup · datos de ejemplo", error);
      }
      redirect("/");
    }
    redirect(result.companySlug ? `/e/${result.companySlug}` : "/");
  });
}
