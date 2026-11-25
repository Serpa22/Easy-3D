import { NextResponse, type NextRequest } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/server/db";
import { machines } from "@/server/db/schema";
import { authenticateBridge } from "@/server/printers/bridges";

export const dynamic = "force-dynamic";

/** Devuelve al bridge las máquinas que tiene asignadas, con sus datos de conexión. */
export async function GET(request: NextRequest) {
  const db = await getDb();
  const bridge = await authenticateBridge(db, request.headers.get("authorization"), request.headers.get("x-bridge-version"));
  if (!bridge) return NextResponse.json({ error: "Token no válido" }, { status: 401 });
  const rows = await db
    .select({ id: machines.id, name: machines.name, technology: machines.technology, connectionType: machines.connectionType, config: machines.connectionConfig })
    .from(machines)
    .where(and(eq(machines.bridgeId, bridge.id), ne(machines.connectionType, "none"), ne(machines.status, "retired")));
  return NextResponse.json(
    { bridge: { id: bridge.id, name: bridge.name }, machines: rows, pollSec: 30 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
