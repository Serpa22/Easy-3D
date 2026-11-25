/** Gestión de usuarios como funciones de (db, datos): testables sin sesión. */
import "server-only";
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "@/server/db";
import { sessions, users } from "@/server/db/schema";
import { count } from "@/server/db/sql";
import type { UserRole } from "@/lib/domain";
import { ActionError } from "@/server/action";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { normalizeEmail } from "@/server/auth/users";

async function ownerCount(db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0]): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users).where(eq(users.role, "owner"));
  return row.n;
}

export async function createUser(db: Db, input: { name: string; email: string; password: string; role: UserRole }) {
  const email = normalizeEmail(input.email);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw new ActionError("Revisa los campos marcados.", { email: "Ya existe un usuario con este correo" });
  const passwordHash = await hashPassword(input.password);
  const [row] = await db.insert(users).values({ name: input.name, email, passwordHash, role: input.role }).returning({ id: users.id });
  return row;
}

/** Cambia el rol. Nunca deja la organización sin propietarios. */
export async function setUserRole(db: Db, userId: string, role: UserRole) {
  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new ActionError("El usuario ya no existe.");
    if (user.role === "owner" && role !== "owner" && (await ownerCount(tx)) <= 1) throw new ActionError("Debe quedar al menos un propietario.");
    await tx.update(users).set({ role }).where(eq(users.id, userId));
  });
}

/** Elimina un usuario (y sus sesiones). No puede ser uno mismo ni el último propietario. */
export async function deleteUser(db: Db, actingUserId: string, userId: string) {
  if (actingUserId === userId) throw new ActionError("No puedes eliminar tu propia cuenta.");
  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new ActionError("El usuario ya no existe.");
    if (user.role === "owner" && (await ownerCount(tx)) <= 1) throw new ActionError("Debe quedar al menos un propietario.");
    await tx.delete(users).where(eq(users.id, userId));
  });
}

/** Cambia nombre y/o contraseña propios. La contraseña exige la actual y cierra el resto de sesiones. */
export async function updateOwnAccount(db: Db, userId: string, currentSessionId: string | null, input: { name: string; currentPassword?: string | null; newPassword?: string | null }) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new ActionError("La cuenta ya no existe.");
  const patch: Partial<typeof users.$inferInsert> = { name: input.name };
  if (input.newPassword) {
    if (!input.currentPassword || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new ActionError("Revisa los campos marcados.", { currentPassword: "La contraseña actual no es correcta" });
    }
    patch.passwordHash = await hashPassword(input.newPassword);
  }
  await db.update(users).set(patch).where(eq(users.id, userId));
  if (input.newPassword) {
    await db.delete(sessions).where(currentSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)) : eq(sessions.userId, userId));
  }
}
