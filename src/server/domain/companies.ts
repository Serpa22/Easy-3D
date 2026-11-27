/** Alta de sub-empresas y numeración de pedidos. */
import "server-only";
import { eq, like, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { companies, type Company } from "@/server/db/schema";

/** «Prokeys Estudio 3D» → «prokeys-estudio-3d» */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "empresa";
}

/** Slugs que chocarían con rutas de la app. */
const RESERVED_SLUGS = new Set(["nueva", "new", "ajustes", "api", "login", "setup"]);

export async function uniqueCompanySlug(db: DbOrTx, name: string): Promise<string> {
  let base = slugify(name);
  if (RESERVED_SLUGS.has(base)) base = `${base}-3d`;
  const taken = new Set(
    (await db.select({ slug: companies.slug }).from(companies).where(like(companies.slug, `${base}%`))).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Monograma por defecto: iniciales de hasta dos palabras («Prokeys Estudio» → «PE», «Figuras» → «FI»). */
export function defaultMonogram(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "E3";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Prefijo de pedidos por defecto: consonantes/letras iniciales («Prokeys» → «PRO»). */
export function defaultOrderPrefix(name: string): string {
  const letters = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
  return letters.slice(0, 3) || "P";
}

export interface NewCompanyInput {
  name: string;
  activity?: string | null;
  description?: string | null;
}

export async function createCompany(db: DbOrTx, input: NewCompanyInput): Promise<Company> {
  const slug = await uniqueCompanySlug(db, input.name);
  const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${companies.sortOrder}), -1)::int + 1` }).from(companies);
  const [company] = await db
    .insert(companies)
    .values({
      name: input.name,
      slug,
      activity: input.activity ?? null,
      description: input.description ?? null,
      monogram: defaultMonogram(input.name),
      orderPrefix: defaultOrderPrefix(input.name),
      sortOrder: Number(next) || 0,
    })
    .returning();
  return company;
}

/**
 * Reserva el siguiente número de pedido de la empresa («PRO-0042»).
 * Llamar dentro de la transacción que crea el pedido.
 */
export async function nextOrderNumber(tx: DbOrTx, companyId: string): Promise<string> {
  const [row] = await tx
    .update(companies)
    .set({ orderSeq: sql`${companies.orderSeq} + 1` })
    .where(eq(companies.id, companyId))
    .returning({ seq: companies.orderSeq, prefix: companies.orderPrefix });
  return `${row.prefix}-${String(row.seq).padStart(4, "0")}`;
}
