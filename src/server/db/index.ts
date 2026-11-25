/**
 * Acceso a la base de datos.
 *
 *  - Con `DATABASE_URL` → PostgreSQL real (Supabase, Neon, un Postgres propio…).
 *  - Sin ella          → PGlite: un PostgreSQL embebido que guarda los datos en
 *                        la carpeta `.data/` (cero instalación, ideal para
 *                        ejecutar la app en un PC o mini-PC del taller).
 *
 * El mismo esquema y las mismas consultas sirven para los dos.
 * Las migraciones de `drizzle/` se aplican solas al arrancar.
 */
import "server-only";
import path from "node:path";
import fs from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Tipo del `tx` dentro de `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Acepta tanto la BD como una transacción abierta. */
export type DbOrTx = Db | Tx;

type Holder = { promise?: Promise<Db>; close?: () => Promise<void> };
const holder: Holder = ((globalThis as unknown as { __e3dDb?: Holder }).__e3dDb ??= {});

function migrationsFolder() {
  return path.join(process.cwd(), "drizzle");
}

export function dataDir() {
  return process.env.E3D_DATA_DIR ? path.resolve(process.env.E3D_DATA_DIR) : path.join(process.cwd(), ".data");
}

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    // `prepare: false` es necesario con los poolers en modo transacción (Supabase).
    const client = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 5), prepare: false });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    holder.close = () => client.end({ timeout: 5 });
    return db as unknown as Db;
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const memory = process.env.E3D_DB === "memory";
  let client;
  if (memory) {
    client = new PGlite();
  } else {
    const dir = path.join(dataDir(), "pg");
    fs.mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
  }
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  holder.close = () => client.close();
  return db as unknown as Db;
}

/** Devuelve la conexión (única por proceso), creando y migrando la BD si hace falta. */
export function getDb(): Promise<Db> {
  if (!holder.promise) {
    holder.promise = connect().catch((error) => {
      holder.promise = undefined;
      throw error;
    });
  }
  return holder.promise;
}

/** Cierra la conexión (tests y scripts). */
export async function closeDb() {
  const close = holder.close;
  holder.promise = undefined;
  holder.close = undefined;
  if (close) await close();
}

export { schema };
