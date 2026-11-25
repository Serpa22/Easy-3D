import { closeDb, getDb } from "@/server/db";
import { companies, type Company } from "@/server/db/schema";
import { createCompany } from "@/server/domain/companies";

/**
 * BD nueva con las migraciones aplicadas.
 *
 * Por defecto es PGlite en memoria. Con `E3D_TEST_DATABASE_URL` los mismos tests
 * corren contra un PostgreSQL real (`npm run test:pg`), que es más estricto con
 * los tipos de los parámetros: así se detectan consultas que solo funcionan en PGlite.
 * ¡Esa base de datos se vacía en cada test!
 */
export async function freshDb() {
  await closeDb();
  const url = process.env.E3D_TEST_DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const admin = postgres(url, { max: 1, onnotice: () => {} });
    await admin.unsafe("drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;");
    await admin.end({ timeout: 5 });
    process.env.DATABASE_URL = url;
  }
  return getDb();
}

export async function makeCompany(name = "Teclas", patch: Partial<typeof companies.$inferInsert> = {}): Promise<Company> {
  const db = await getDb();
  const company = await createCompany(db, { name });
  if (Object.keys(patch).length === 0) return company;
  const { eq } = await import("drizzle-orm");
  const [updated] = await db.update(companies).set(patch).where(eq(companies.id, company.id)).returning();
  return updated;
}
