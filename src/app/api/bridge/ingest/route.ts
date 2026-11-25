import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db";
import { logError } from "@/server/log";
import { machines } from "@/server/db/schema";
import { authenticateBridge } from "@/server/printers/bridges";
import { applyTelemetry } from "@/server/printers/ingest";

export const dynamic = "force-dynamic";

const MAX_BODY = 512 * 1024;
const bodySchema = z.object({
  items: z
    .array(
      z.object({
        machineId: z.uuid(),
        // La telemetría se normaliza y acota en la ingesta (sanitizeTelemetry).
        telemetry: z.record(z.string(), z.unknown()),
        at: z.iso.datetime({ offset: true }),
      }),
    )
    .min(1)
    .max(100),
});

/**
 * Lee el cuerpo con un tope: se rechaza por `Content-Length` antes de leer nada
 * y, si el tamaño no se declara o es falso, se corta en cuanto se supera el
 * límite (nunca se acumula un cuerpo enorme en memoria).
 */
async function readBody(request: NextRequest, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Recibe telemetría de un bridge. Solo se aceptan máquinas asignadas a ese bridge. */
export async function POST(request: NextRequest) {
  const db = await getDb();
  const bridge = await authenticateBridge(db, request.headers.get("authorization"), request.headers.get("x-bridge-version"));
  if (!bridge) return NextResponse.json({ error: "Token no válido" }, { status: 401 });

  const text = await readBody(request, MAX_BODY);
  if (text === null) return NextResponse.json({ error: "Cuerpo demasiado grande" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "JSON no válido" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Formato no válido" }, { status: 400 });

  const ids = [...new Set(parsed.data.items.map((i) => i.machineId))];
  const owned = new Set(
    (await db.select({ id: machines.id }).from(machines).where(and(eq(machines.bridgeId, bridge.id), inArray(machines.id, ids)))).map((m) => m.id),
  );
  let accepted = 0;
  for (const item of parsed.data.items) {
    if (!owned.has(item.machineId)) continue;
    try {
      await applyTelemetry(db, { machineId: item.machineId, telemetry: item.telemetry as never, at: item.at });
      accepted += 1;
    } catch (error) {
      logError("bridge · ingesta", error);
    }
  }
  return NextResponse.json({ ok: true, accepted });
}
