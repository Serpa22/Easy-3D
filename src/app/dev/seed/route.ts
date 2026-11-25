import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { removeDemoData, seedDemoData } from "@/server/demo/seed";
import { notifyMachineChanged } from "@/server/printers";

/** Solo desarrollo: carga los datos de demostración. */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "No disponible" }, { status: 404 });
  const user = await getCurrentUser();
  if (user?.role !== "owner") return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const started = Date.now();
  if (new URL(request.url).searchParams.has("reset")) await removeDemoData();
  await seedDemoData();
  await notifyMachineChanged();
  return NextResponse.json({ ok: true, ms: Date.now() - started });
}
