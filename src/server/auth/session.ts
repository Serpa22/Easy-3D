/**
 * Sesiones: cookie httpOnly con un token aleatorio; en BD solo se guarda su
 * hash SHA-256.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "@/server/db";
import { sessions, users, type User } from "@/server/db/schema";

export const SESSION_COOKIE = "e3d_session";
const SESSION_DAYS = 30;
const DAY_MS = 86_400_000;

export type SessionUser = Pick<User, "id" | "email" | "name" | "role">;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function isSecureRequest(): Promise<boolean> {
  if (process.env.E3D_SECURE_COOKIES === "true") return true;
  if (process.env.E3D_SECURE_COOKIES === "false") return false;
  const h = await headers();
  return h.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
}

export async function createSession(userId: string): Promise<void> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  const h = await headers();
  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    expiresAt,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  });
  // Limpieza oportunista de sesiones caducadas.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await isSecureRequest(),
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  }
  jar.delete(SESSION_COOKIE);
}

/** Usuario de la petición actual, o null. Memorizado por petición. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
});

/** Exige sesión: si no la hay, redirige al login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Exige sesión de propietario (gestión de usuarios y ajustes globales). */
export async function requireOwner(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/");
  return user;
}
