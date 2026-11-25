import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { getCompanyBySlug } from "@/server/context";
import { getDb } from "@/server/db";
import { getLiveSnapshot } from "@/server/queries/live";

export const dynamic = "force-dynamic";

/**
 * Estado en directo de las máquinas.
 *   GET /api/live                → todas las sub-empresas (vista de grupo)
 *   GET /api/live?company=<slug> → solo una sub-empresa
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const slug = request.nextUrl.searchParams.get("company");
  let companyId: string | undefined;
  if (slug) {
    const company = await getCompanyBySlug(slug);
    if (!company) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    companyId = company.id;
  }
  const snapshot = await getLiveSnapshot(await getDb(), { companyId });
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
