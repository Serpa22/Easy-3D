import { closeDb, getDb } from "@/server/db";
import { companies, type Company } from "@/server/db/schema";
import { createCompany } from "@/server/domain/companies";

/** BD nueva en memoria (PGlite) con las migraciones aplicadas. */
export async function freshDb() {
  await closeDb();
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
