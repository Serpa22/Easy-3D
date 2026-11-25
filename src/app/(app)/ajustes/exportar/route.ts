import { NextResponse } from "next/server";
import { maskConnectionConfig } from "@/lib/connections";
import { todayISO } from "@/lib/dates";
import { getCurrentUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import * as s from "@/server/db/schema";
import { getOrgSettings } from "@/server/settings";

export const dynamic = "force-dynamic";

/**
 * Copia de seguridad en JSON de todos los datos de negocio (solo propietarios).
 * Excluye contraseñas, sesiones, tokens de bridges y secretos de impresoras.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Solo un propietario puede descargar la copia" }, { status: 403 });
  const [db, org] = await Promise.all([getDb(), getOrgSettings()]);
  const [companies, machines, machineEvents, maintenanceLogs, materials, materialMovements, products, customers, orders, orderItems, shipments, printJobs, recurringExpenses, transactions, energyBills, bridges, users] = await Promise.all([
    db.select().from(s.companies),
    db.select().from(s.machines),
    db.select().from(s.machineEvents),
    db.select().from(s.maintenanceLogs),
    db.select().from(s.materials),
    db.select().from(s.materialMovements),
    db.select().from(s.products),
    db.select().from(s.customers),
    db.select().from(s.orders),
    db.select().from(s.orderItems),
    db.select().from(s.shipments),
    db.select().from(s.printJobs),
    db.select().from(s.recurringExpenses),
    db.select().from(s.transactions),
    db.select().from(s.energyBills),
    db.select({ id: s.bridges.id, name: s.bridges.name, createdAt: s.bridges.createdAt }).from(s.bridges),
    db.select({ id: s.users.id, name: s.users.name, email: s.users.email, role: s.users.role, createdAt: s.users.createdAt }).from(s.users),
  ]);
  const today = todayISO(org.timeZone);
  const body = {
    app: "Easy 3D",
    version: 1,
    exportedAt: new Date().toISOString(),
    organization: org,
    users,
    bridges,
    companies,
    // Los datos de conexión se exportan sin secretos.
    machines: machines.map((m) => ({ ...m, connectionConfig: maskConnectionConfig(m.connectionType, m.connectionConfig) })),
    machineEvents,
    maintenanceLogs,
    materials,
    materialMovements,
    products,
    customers,
    orders,
    orderItems,
    shipments,
    printJobs,
    recurringExpenses,
    transactions,
    energyBills,
  };
  return new Response(JSON.stringify(body, null, 1), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="easy3d-copia-${today}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
