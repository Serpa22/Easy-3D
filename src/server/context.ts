/**
 * Contexto de petición: usuario + empresa activa.
 * TODA página y acción de `/e/[company]/…` empieza por `requireCompany(slug)`.
 */
import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { asc, eq, isNull } from "drizzle-orm";
import { getDb, type Db } from "@/server/db";
import { companies, type Company } from "@/server/db/schema";
import { requireUser, type SessionUser } from "@/server/auth/session";
import { getOrgSettings, type OrgSettings } from "@/server/settings";

export interface CompanyContext {
  user: SessionUser;
  company: Company;
  db: Db;
  org: OrgSettings;
}

export const getCompanyBySlug = cache(async (slug: string): Promise<Company | null> => {
  const db = await getDb();
  const rows = await db.select().from(companies).where(eq(companies.slug, slug)).limit(1);
  return rows[0] ?? null;
});

/** Empresas activas (no archivadas), en orden. */
export const listCompanies = cache(async (): Promise<Company[]> => {
  const db = await getDb();
  return db
    .select()
    .from(companies)
    .where(isNull(companies.archivedAt))
    .orderBy(asc(companies.sortOrder), asc(companies.createdAt));
});

/**
 * Exige sesión y devuelve la empresa de la URL. 404 si no existe.
 * Usa SIEMPRE `company.id` de aquí para filtrar y escribir datos: nunca te
 * fíes de un `companyId` que venga del cliente.
 */
export async function requireCompany(slug: string): Promise<CompanyContext> {
  const user = await requireUser();
  const [company, db, org] = await Promise.all([getCompanyBySlug(slug), getDb(), getOrgSettings()]);
  if (!company) notFound();
  return { user, company, db, org };
}
