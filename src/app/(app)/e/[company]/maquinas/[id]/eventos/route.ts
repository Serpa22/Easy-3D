import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompany } from "@/server/context";
import { listMachineEvents } from "@/server/queries/machines";

export const dynamic = "force-dynamic";

/** Últimos eventos de una máquina (para la línea de tiempo en directo). */
export async function GET(_request: Request, { params }: { params: Promise<{ company: string; id: string }> }) {
  const { company: slug, id } = await params;
  const { company, db } = await requireCompany(slug);
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ events: [] }, { status: 404 });
  const events = await listMachineEvents(db, company.id, id, 40);
  return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } });
}
