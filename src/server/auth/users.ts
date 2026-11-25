import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { users } from "@/server/db/schema";
import { count } from "@/server/db/sql";

/** ¿Existe ya algún usuario? Si no, la app muestra el asistente de primer arranque. */
export async function hasUsers(): Promise<boolean> {
  const db = await getDb();
  const [row] = await db.select({ n: count() }).from(users);
  return (row?.n ?? 0) > 0;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(email: string) {
  const db = await getDb();
  const rows = await db.select().from(users).where(eq(users.email, normalizeEmail(email))).limit(1);
  return rows[0] ?? null;
}
