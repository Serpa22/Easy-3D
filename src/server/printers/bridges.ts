/** Programas puente (bridges): alta, listado, baja y autenticación por token. */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { bridges, machines, type Bridge } from "@/server/db/schema";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Crea un bridge. El token solo se devuelve aquí: en BD se guarda su hash. */
export async function createBridge(db: DbOrTx, name: string): Promise<{ id: string; token: string }> {
  const token = `e3d_${randomBytes(32).toString("base64url")}`;
  const [row] = await db.insert(bridges).values({ name: name.trim().slice(0, 80) || "Bridge", tokenHash: hash(token) }).returning({ id: bridges.id });
  return { id: row.id, token };
}

export interface BridgeRow {
  id: string;
  name: string;
  lastSeenAt: Date | null;
  version: string | null;
  createdAt: Date;
  machineCount: number;
  /** Ha dado señal en los últimos 2 minutos. */
  alive: boolean;
}

export async function listBridges(db: DbOrTx): Promise<BridgeRow[]> {
  const rows = await db
    .select({
      id: bridges.id,
      name: bridges.name,
      lastSeenAt: bridges.lastSeenAt,
      version: bridges.version,
      createdAt: bridges.createdAt,
      machineCount: sql<number>`(select count(*)::int from ${machines} where ${machines.bridgeId} = ${bridges.id})`.mapWith(Number),
    })
    .from(bridges)
    .orderBy(bridges.createdAt);
  const now = Date.now();
  return rows.map((b) => ({ ...b, alive: b.lastSeenAt !== null && now - b.lastSeenAt.getTime() < 120_000 }));
}

/** Borra un bridge; sus máquinas pasan a «este servidor» (bridgeId → null). */
export async function deleteBridge(db: DbOrTx, id: string): Promise<void> {
  await db.delete(bridges).where(eq(bridges.id, id));
}

/** Valida la cabecera `Authorization: Bearer <token>` y devuelve el bridge, o null. */
export async function authenticateBridge(db: DbOrTx, authorization: string | null, version?: string | null): Promise<Bridge | null> {
  const match = /^Bearer\s+(\S{20,200})$/i.exec(authorization ?? "");
  if (!match) return null;
  const [bridge] = await db.select().from(bridges).where(eq(bridges.tokenHash, hash(match[1]))).limit(1);
  if (!bridge) return null;
  const stale = !bridge.lastSeenAt || Date.now() - bridge.lastSeenAt.getTime() > 30_000;
  const cleanVersion = version?.slice(0, 40) ?? null;
  if (stale || (cleanVersion && cleanVersion !== bridge.version)) {
    await db.update(bridges).set({ lastSeenAt: new Date(), ...(cleanVersion ? { version: cleanVersion } : {}) }).where(eq(bridges.id, bridge.id));
  }
  return bridge;
}
