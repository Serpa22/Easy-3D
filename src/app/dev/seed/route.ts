import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { seedDemoData } from "@/server/demo/seed";

/** Solo desarrollo: carga los datos de demostración. */
export async function GET() {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "No disponible" }, { status: 404 });
  const user = await getCurrentUser();
  if (user?.role !== "owner") return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const started = Date.now();
  await seedDemoData();
  return NextResponse.json({ ok: true, ms: Date.now() - started });
}
