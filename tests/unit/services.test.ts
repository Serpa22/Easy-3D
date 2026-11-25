import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { machines, materials, orders, printJobs, products, shipments, transactions } from "@/server/db/schema";
import { deleteOrder, orderInputSchema, saveOrder, updateOrderState } from "@/server/domain/orders-service";
import { editJobSchema, finishJobSchema, finishOpenJob, logFinishedJob, logJobSchema, startJobSchema, startManualJob, updateClosedJob } from "@/server/domain/prints-service";
import { deleteShipment, saveShipment, setShipmentStatus, shipmentInputSchema } from "@/server/domain/shipments-service";
import { createUser, deleteUser, setUserRole, updateOwnAccount } from "@/server/domain/users-service";
import { freshDb, makeCompany } from "../helpers/db";

const TODAY = "2026-11-25";

async function setup() {
  const db = await getDb();
  const company = await makeCompany("Teclas", { electricityMode: "fixed", kwhPrice: 0.2 });
  const other = await makeCompany("Figuras");
  const [pla] = await db.insert(materials).values({ companyId: company.id, name: "PLA", unit: "g", stockQty: 1000, packSize: 1000, packCostCents: 2000 }).returning();
  const [petg] = await db.insert(materials).values({ companyId: company.id, name: "PETG", unit: "g", stockQty: 1000, packSize: 1000, packCostCents: 2500 }).returning();
  const [machine] = await db.insert(machines).values({ companyId: company.id, name: "MK4S", powerPrintW: 100, loadedMaterialId: pla.id }).returning();
  const [product] = await db.insert(products).values({ companyId: company.id, name: "Set", priceCents: 2500, stockQty: 10 }).returning();
  const [foreign] = await db.insert(products).values({ companyId: other.id, name: "Dragón", priceCents: 4990 }).returning();
  return { db, company, other, pla, petg, machine, product, foreign };
}
const order = (patch: Record<string, unknown> = {}) =>
  orderInputSchema.parse({ customerName: "Lucía", channel: "web", status: "pending", paymentStatus: "unpaid", orderDate: TODAY, items: [{ description: "Set", quantity: "2", unitPrice: "25,00" }], shippingCharged: "4,50", ...patch });
const stock = async (id: string) => (await (await getDb()).select().from(products).where(eq(products.id, id)))[0].stockQty;
const matStock = async (id: string) => (await (await getDb()).select().from(materials).where(eq(materials.id, id)))[0].stockQty;

beforeEach(async () => {
  await freshDb();
});

describe("servicio de pedidos", () => {
  it("recalcula los totales en servidor y rechaza productos de otra empresa", async () => {
    const { db, company, product, foreign } = await setup();
    const saved = await saveOrder(db, company, order({ items: [{ productId: product.id, description: "Set", quantity: "2", unitPrice: "25,00" }] }), TODAY);
    const [row] = await db.select().from(orders).where(eq(orders.id, saved.id));
    expect(row).toMatchObject({ number: "TEC-0001", subtotalCents: 5000, shippingChargedCents: 450, totalCents: 5450 });
    await expect(saveOrder(db, company, order({ items: [{ productId: foreign.id, description: "x", quantity: "1", unitPrice: "1" }] }), TODAY)).rejects.toThrow("productos ya no existe");
    // Un pedido fallido no consume numeración.
    expect((await saveOrder(db, company, order(), TODAY)).number).toBe("TEC-0002");
  });

  it("cobrar, enviar, editar y borrar mantienen finanzas y stock", async () => {
    const { db, company, other, product } = await setup();
    const { id } = await saveOrder(db, company, order({ items: [{ productId: product.id, description: "Set", quantity: "2", unitPrice: "25,00" }] }), TODAY);
    await updateOrderState(db, company.id, id, { paid: true, status: "shipped" }, TODAY);
    expect(await stock(product.id)).toBe(8);
    expect((await db.select().from(transactions)).map((t) => t.amountCents)).toEqual([5450]);
    // Editar las líneas de un pedido enviado y cobrado.
    await saveOrder(db, company, order({ id, status: "shipped", paymentStatus: "paid", items: [{ productId: product.id, description: "Set", quantity: "5", unitPrice: "20,00" }] }), TODAY);
    expect(await stock(product.id)).toBe(5);
    expect((await db.select().from(transactions)).map((t) => t.amountCents)).toEqual([10450]);
    // Desde otra empresa no se puede tocar ni borrar.
    await expect(updateOrderState(db, other.id, id, { paid: false }, TODAY)).rejects.toThrow();
    await expect(deleteOrder(db, other.id, id)).rejects.toThrow();
    await deleteOrder(db, company.id, id);
    expect(await stock(product.id)).toBe(10);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });
});

describe("servicio de envíos", () => {
  it("apunta el gasto, hace avanzar el pedido y nunca lo hace retroceder", async () => {
    const { db, company, other, product } = await setup();
    const { id: orderId } = await saveOrder(db, company, order({ status: "ready", items: [{ productId: product.id, description: "Set", quantity: "2", unitPrice: "25,00" }] }), TODAY);
    const input = (patch: Record<string, unknown> = {}) => shipmentInputSchema.parse({ orderId, carrier: "correos", status: "pending", cost: "4,20", trackingNumber: "PQ123", ...patch });
    const shipment = await saveShipment(db, company.id, input(), TODAY);
    expect(shipment.trackingUrl).toContain("PQ123");
    expect((await db.select().from(orders).where(eq(orders.id, orderId)))[0].status).toBe("ready");
    expect((await db.select().from(transactions)).find((t) => t.sourceType === "shipment")?.amountCents).toBe(420);

    await setShipmentStatus(db, company.id, shipment.id, "in_transit", TODAY);
    expect((await db.select().from(orders).where(eq(orders.id, orderId)))[0].status).toBe("shipped");
    expect(await stock(product.id)).toBe(8); // al enviar se descuenta el stock
    await setShipmentStatus(db, company.id, shipment.id, "delivered", TODAY);
    expect((await db.select().from(orders).where(eq(orders.id, orderId)))[0].status).toBe("delivered");
    // Un segundo envío «pendiente» no devuelve el pedido a un estado anterior.
    await saveShipment(db, company.id, input({ status: "label_created", cost: "" }), TODAY);
    expect((await db.select().from(orders).where(eq(orders.id, orderId)))[0].status).toBe("delivered");

    // Coste a cero → sin gasto; borrar → sin gasto. Otra empresa no puede enlazar ni borrar.
    await saveShipment(db, company.id, input({ id: shipment.id, status: "delivered", cost: "0" }), TODAY);
    expect((await db.select().from(transactions)).filter((t) => t.sourceType === "shipment")).toHaveLength(0);
    await expect(saveShipment(db, other.id, input(), TODAY)).rejects.toThrow();
    await expect(deleteShipment(db, other.id, shipment.id)).rejects.toThrow();
    await deleteShipment(db, company.id, shipment.id);
    expect((await db.select().from(shipments)).length).toBe(1);
  });

  it("rechaza enlaces de seguimiento que no sean http(s) y fechas incoherentes", () => {
    expect(shipmentInputSchema.safeParse({ carrier: "otro", status: "pending", trackingUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(shipmentInputSchema.safeParse({ carrier: "otro", status: "delivered", shippedAt: "2026-11-20", deliveredAt: "2026-11-19" }).success).toBe(false);
    expect(shipmentInputSchema.safeParse({ carrier: "otro", status: "pending", trackingUrl: "https://ejemplo.test/x" }).success).toBe(true);
  });
});

describe("servicio de impresiones", () => {
  const now = new Date("2026-11-25T12:00:00Z");
  it("no permite dos impresiones manuales abiertas en una máquina y cierra con su efecto", async () => {
    const { db, company, machine, pla, product } = await setup();
    const start = startJobSchema.parse({ machineId: machine.id, name: "Bandeja 1", productId: product.id, estimatedHours: "2" });
    const job = await startManualJob(db, company.id, start, new Date("2026-11-25T10:00:00Z"));
    expect(job.estimatedSec).toBe(7200);
    await expect(startManualJob(db, company.id, start, now)).rejects.toThrow("ya tiene una impresión en curso");
    await finishOpenJob(db, company.id, finishJobSchema.parse({ jobId: job.id, status: "completed", materialUsed: "80", piecesProduced: "6" }), "Europe/Madrid", now);
    expect(await matStock(pla.id)).toBe(920);
    expect(await stock(product.id)).toBe(16);
    await expect(finishOpenJob(db, company.id, finishJobSchema.parse({ jobId: job.id, status: "completed" }), "Europe/Madrid", now)).rejects.toThrow("ya estaba cerrada");
  });

  it("corregir una impresión cerrada mueve el consumo al material correcto sin duplicar nada", async () => {
    const { db, company, machine, pla, petg, product } = await setup();
    const job = await logFinishedJob(db, company.id, logJobSchema.parse({ machineId: machine.id, name: "Bandeja 2", productId: product.id, startedAt: "2026-11-25T09:00", endedAt: "2026-11-25T11:00", status: "completed", materialUsed: "100", piecesProduced: "4" }), "Europe/Madrid", now);
    expect(job.durationSec).toBe(7200);
    expect(await matStock(pla.id)).toBe(900);
    const edited = await updateClosedJob(db, company.id, editJobSchema.parse({ jobId: job.id, name: "Bandeja 2", materialId: petg.id, durationMinutes: "90", status: "completed", materialUsed: "60", piecesProduced: "3" }), "Europe/Madrid");
    expect(await matStock(pla.id)).toBe(1000); // se devuelve al material anterior
    expect(await matStock(petg.id)).toBe(940);
    expect(await stock(product.id)).toBe(10); // el producto ya no está enlazado: se retiran sus 4 piezas
    expect(edited).toMatchObject({ durationSec: 5400, materialCostCents: 150, productId: null });
    expect((await db.select().from(machines).where(eq(machines.id, machine.id)))[0].totalPrintSeconds).toBe(5400);
    expect(await db.select().from(printJobs)).toHaveLength(1);
  });

  it("interpreta las horas en la zona horaria de la organización y valida el orden", async () => {
    const { db, company, machine } = await setup();
    const input = (patch: Record<string, unknown>) => logJobSchema.parse({ machineId: machine.id, name: "x", startedAt: "2026-11-25T09:00", endedAt: "2026-11-25T10:00", status: "completed", ...patch });
    const job = await logFinishedJob(db, company.id, input({}), "Europe/Madrid", now);
    expect(job.startedAt.toISOString()).toBe("2026-11-25T08:00:00.000Z");
    await expect(logFinishedJob(db, company.id, input({ endedAt: "2026-11-25T08:00" }), "Europe/Madrid", now)).rejects.toThrow();
    await expect(logFinishedJob(db, company.id, input({ endedAt: "2026-11-26T10:00" }), "Europe/Madrid", now)).rejects.toThrow();
  });
});

describe("servicio de usuarios", () => {
  it("protege al último propietario, la cuenta propia y el cambio de contraseña", async () => {
    await freshDb();
    const db = await getDb();
    const owner = await createUser(db, { name: "Ana", email: "Ana@Easy3d.test", password: "contraseña-1", role: "owner" });
    const member = await createUser(db, { name: "Luis", email: "luis@easy3d.test", password: "contraseña-2", role: "member" });
    await expect(createUser(db, { name: "Otra", email: "ana@easy3d.test", password: "contraseña-3", role: "member" })).rejects.toThrow();
    await expect(setUserRole(db, owner.id, "member")).rejects.toThrow("al menos un propietario");
    await expect(deleteUser(db, owner.id, owner.id)).rejects.toThrow("tu propia cuenta");
    await expect(deleteUser(db, member.id, owner.id)).rejects.toThrow("al menos un propietario");
    await expect(updateOwnAccount(db, member.id, null, { name: "Luis", currentPassword: "mala", newPassword: "nueva-contraseña" })).rejects.toThrow();
    await updateOwnAccount(db, member.id, null, { name: "Luis M.", currentPassword: "contraseña-2", newPassword: "nueva-contraseña" });
    await setUserRole(db, member.id, "owner");
    await setUserRole(db, owner.id, "member"); // ya hay otro propietario
    await deleteUser(db, member.id, owner.id);
  });
});
