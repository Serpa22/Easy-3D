/**
 * Datos de demostración: dos sub-empresas con historia creíble (máquinas
 * simuladas, materiales, productos, clientes, pedidos, envíos, impresiones,
 * gastos y facturas de luz) para explorar la app.
 *
 * Todo se crea con las mismas funciones de dominio que usa la app, así que el
 * libro contable, el stock y los costes quedan coherentes. Es determinista
 * (misma fecha → mismos datos) e idempotente (no duplica si ya existen).
 */
import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/server/db";
import {
  companies,
  customers,
  energyBills,
  machines,
  maintenanceLogs,
  materials,
  orderItems,
  orders,
  printJobs,
  products,
  recurringExpenses,
  shipments,
  transactions,
  type Company,
  type Machine,
  type Material,
  type Product,
} from "@/server/db/schema";
import { count, sum } from "@/server/db/sql";
import { addDays, addMonths, diffDays, monthOf, monthRange, startOfDayInZone, todayISO } from "@/lib/dates";
import type { MaintenanceType, OrderStatus, SalesChannel, ShipmentStatus } from "@/lib/domain";
import { createCompany, nextOrderNumber } from "@/server/domain/companies";
import { syncEnergyBillExpense, syncMachinePurchaseExpense, syncMaintenanceExpense, syncShipmentExpense } from "@/server/domain/derived-expenses";
import { computeOrderTotals, syncOrderEffects } from "@/server/domain/orders";
import { finishPrintJob, startPrintJob } from "@/server/domain/print-jobs";
import { generateRecurringCharges } from "@/server/domain/recurring";
import { applyMaterialMovement } from "@/server/domain/stock";
import { getOrgSettings } from "@/server/settings";

/** Marca que identifica a las empresas creadas por el generador (para poder borrarlas con seguridad). */
export const DEMO_MARKER = "Empresa de demostración.";
export const DEMO_SLUGS = ["teclas", "figuras"] as const;

/* ------------------------------ Utilidades ------------------------------ */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const pick = <T,>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];
const int = (rng: Rng, min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;
function weighted<T>(rng: Rng, options: ReadonlyArray<readonly [T, number]>): T {
  const total = options.reduce((acc, [, w]) => acc + w, 0);
  let r = rng() * total;
  for (const [value, w] of options) {
    r -= w;
    if (r <= 0) return value;
  }
  return options[options.length - 1][0];
}

const FIRST = ["Lucía", "Marc", "Paula", "Hugo", "Carla", "Pau", "Noa", "Álex", "Irene", "Dani", "Marta", "Iván", "Laia", "Sergio", "Nuria", "Adrián", "Clara", "Jordi", "Elena", "Rubén", "Aina", "Óscar", "Sara", "Biel"];
const LAST = ["Ferrer", "Vidal", "Soler", "Puig", "Roca", "Serra", "Molina", "Navarro", "Ortega", "Castillo", "Rubio", "Marín", "Iglesias", "Cano", "Prieto", "Gallego", "Pascual", "Herrero", "Bosch", "Font"];
const CITIES: ReadonlyArray<readonly [string, string, string, string]> = [
  ["Barcelona", "08012", "Barcelona", "España"],
  ["Madrid", "28004", "Madrid", "España"],
  ["Valencia", "46003", "Valencia", "España"],
  ["Sevilla", "41002", "Sevilla", "España"],
  ["Bilbao", "48005", "Bizkaia", "España"],
  ["Zaragoza", "50001", "Zaragoza", "España"],
  ["Girona", "17001", "Girona", "España"],
  ["Málaga", "29005", "Málaga", "España"],
  ["A Coruña", "15003", "A Coruña", "España"],
  ["Palma", "07001", "Illes Balears", "España"],
  ["Lisboa", "1100-148", "Lisboa", "Portugal"],
  ["Toulouse", "31000", "Occitanie", "Francia"],
  ["Berlín", "10115", "Berlín", "Alemania"],
];
const STREETS = ["Carrer de Verdi", "Calle Mayor", "Avenida del Puerto", "Carrer de Sants", "Calle de la Luna", "Gran Vía", "Rambla Nova", "Calle Real", "Paseo de Gracia", "Calle Ancha"];

interface MachineSpec {
  name: string;
  brand: string;
  model: string;
  technology: "fdm" | "resin";
  powerPrintW: number;
  powerIdleW: number;
  priceCents: number;
  /** Meses desde la compra. */
  boughtMonthsAgo: number;
  connection: "simulator" | "none";
  status?: "active" | "maintenance";
  /** Índice del material cargado. */
  material: number;
}
interface MaterialSpec {
  name: string;
  kind: "filament" | "resin" | "consumable" | "packaging";
  materialType?: string;
  brand?: string;
  colorName?: string;
  colorHex?: string;
  unit: "g" | "ml" | "ud";
  packSize: number;
  packCostCents: number;
  threshold: number;
  /** Stock final deseado (aprox.) para que la demo enseñe avisos de stock bajo. */
  endStock?: number;
}
interface ProductSpec {
  name: string;
  sku: string;
  category: string;
  priceCents: number;
  material: number;
  materialQty: number;
  printMinutes: number;
  laborMinutes: number;
  packagingCents: number;
  /** Piezas por tanda de impresión. */
  batch: number;
  weight: number;
}
interface CompanySpec {
  seed: number;
  slug: (typeof DEMO_SLUGS)[number];
  name: string;
  activity: string;
  prefix: string;
  monogram: string;
  months: number;
  electricity: "fixed" | "tou";
  customers: number;
  ordersPerWeekStart: number;
  ordersPerWeekEnd: number;
  jobsPerMachineDay: number;
  supplier: string;
  machines: MachineSpec[];
  materials: MaterialSpec[];
  products: ProductSpec[];
  channels: ReadonlyArray<readonly [SalesChannel, number]>;
  recurring: Array<{ name: string; category: string; amountCents: number; counterparty: string; day: number }>;
  jobNames: string[];
}

const TECLAS: CompanySpec = {
  seed: 20260101,
  slug: "teclas",
  name: "Teclas",
  activity: "Teclas artesanales para teclados mecánicos",
  prefix: "TEC",
  monogram: "TE",
  months: 8,
  electricity: "tou",
  customers: 36,
  ordersPerWeekStart: 2.2,
  ordersPerWeekEnd: 6.5,
  jobsPerMachineDay: 0.42,
  supplier: "Filamentos Ibéricos",
  machines: [
    { name: "Bambu Lab P1S · 1", brand: "Bambu Lab", model: "P1S", technology: "fdm", powerPrintW: 135, powerIdleW: 8, priceCents: 74900, boughtMonthsAgo: 14, connection: "simulator", material: 0 },
    { name: "Bambu Lab P1S · 2", brand: "Bambu Lab", model: "P1S", technology: "fdm", powerPrintW: 135, powerIdleW: 8, priceCents: 69900, boughtMonthsAgo: 6, connection: "simulator", material: 1 },
    { name: "Bambu Lab A1 mini", brand: "Bambu Lab", model: "A1 mini", technology: "fdm", powerPrintW: 80, powerIdleW: 6, priceCents: 21900, boughtMonthsAgo: 4, connection: "simulator", material: 2 },
    { name: "Prusa MK4S", brand: "Prusa", model: "MK4S", technology: "fdm", powerPrintW: 110, powerIdleW: 7, priceCents: 98900, boughtMonthsAgo: 20, connection: "none", material: 3 },
    { name: "Ender 3 V3 (taller)", brand: "Creality", model: "Ender 3 V3", technology: "fdm", powerPrintW: 150, powerIdleW: 9, priceCents: 25900, boughtMonthsAgo: 26, connection: "none", status: "maintenance", material: 4 },
  ],
  materials: [
    { name: "PLA Negro mate", kind: "filament", materialType: "PLA", brand: "Sakata", colorName: "Negro", colorHex: "#111111", unit: "g", packSize: 1000, packCostCents: 1990, threshold: 800 },
    { name: "PLA Blanco hueso", kind: "filament", materialType: "PLA", brand: "Sakata", colorName: "Blanco", colorHex: "#f2efe6", unit: "g", packSize: 1000, packCostCents: 1990, threshold: 800 },
    { name: "PETG Translúcido", kind: "filament", materialType: "PETG", brand: "Winkle", colorName: "Translúcido", colorHex: "#cfe3ea", unit: "g", packSize: 1000, packCostCents: 2290, threshold: 600, endStock: 340 },
    { name: "PLA Silk Dorado", kind: "filament", materialType: "PLA", brand: "eSun", colorName: "Dorado", colorHex: "#c9a13b", unit: "g", packSize: 1000, packCostCents: 2490, threshold: 500 },
    { name: "TPU 95A Gris", kind: "filament", materialType: "TPU", brand: "Smartfil", colorName: "Gris", colorHex: "#7a7d80", unit: "g", packSize: 750, packCostCents: 2890, threshold: 400, endStock: 0 },
    { name: "PLA Rojo cereza", kind: "filament", materialType: "PLA", brand: "Sakata", colorName: "Rojo", colorHex: "#b3202a", unit: "g", packSize: 1000, packCostCents: 1990, threshold: 500 },
    { name: "Caja kraft 12×8 cm", kind: "packaging", unit: "ud", packSize: 100, packCostCents: 2800, threshold: 60, endStock: 44 },
    { name: "Bolsa zip antiestática", kind: "packaging", unit: "ud", packSize: 200, packCostCents: 1400, threshold: 80 },
  ],
  products: [
    { name: "Set Cherry 61 teclas · Negro", sku: "TEC-SET61-NG", category: "Sets", priceCents: 4490, material: 0, materialQty: 78, printMinutes: 310, laborMinutes: 12, packagingCents: 45, batch: 1, weight: 9 },
    { name: "Set Cherry 61 teclas · Hueso", sku: "TEC-SET61-HU", category: "Sets", priceCents: 4490, material: 1, materialQty: 78, printMinutes: 310, laborMinutes: 12, packagingCents: 45, batch: 1, weight: 8 },
    { name: "Set TKL 87 teclas · Negro", sku: "TEC-SET87-NG", category: "Sets", priceCents: 5990, material: 0, materialQty: 112, printMinutes: 430, laborMinutes: 15, packagingCents: 45, batch: 1, weight: 6 },
    { name: "Tecla artesanal Dragón", sku: "TEC-ART-DRG", category: "Artesanales", priceCents: 1690, material: 3, materialQty: 6, printMinutes: 48, laborMinutes: 8, packagingCents: 20, batch: 6, weight: 10 },
    { name: "Tecla artesanal Montaña", sku: "TEC-ART-MNT", category: "Artesanales", priceCents: 1490, material: 2, materialQty: 5, printMinutes: 42, laborMinutes: 8, packagingCents: 20, batch: 6, weight: 9 },
    { name: "Tecla artesanal Gato", sku: "TEC-ART-GAT", category: "Artesanales", priceCents: 1490, material: 5, materialQty: 5, printMinutes: 40, laborMinutes: 8, packagingCents: 20, batch: 6, weight: 8 },
    { name: "Barra espaciadora 6.25u", sku: "TEC-SPC-625", category: "Sueltas", priceCents: 890, material: 0, materialQty: 9, printMinutes: 55, laborMinutes: 3, packagingCents: 15, batch: 4, weight: 5 },
    { name: "Pack 4 flechas translúcidas", sku: "TEC-ARR-TR", category: "Sueltas", priceCents: 990, material: 2, materialQty: 7, printMinutes: 46, laborMinutes: 4, packagingCents: 15, batch: 5, weight: 6 },
    { name: "Tecla Escape Silk Dorado", sku: "TEC-ESC-DOR", category: "Sueltas", priceCents: 690, material: 3, materialQty: 3, printMinutes: 22, laborMinutes: 3, packagingCents: 15, batch: 9, weight: 6 },
    { name: "Reposamuñecas flexible", sku: "TEC-RPM-TPU", category: "Accesorios", priceCents: 2490, material: 4, materialQty: 95, printMinutes: 280, laborMinutes: 6, packagingCents: 45, batch: 1, weight: 3 },
    { name: "Extractor de teclas", sku: "TEC-EXT-01", category: "Accesorios", priceCents: 490, material: 5, materialQty: 8, printMinutes: 26, laborMinutes: 2, packagingCents: 10, batch: 8, weight: 4 },
    { name: "Soporte expositor 12 teclas", sku: "TEC-EXP-12", category: "Accesorios", priceCents: 1890, material: 1, materialQty: 64, printMinutes: 190, laborMinutes: 5, packagingCents: 45, batch: 1, weight: 3 },
  ],
  channels: [["web", 34], ["etsy", 30], ["instagram", 14], ["wallapop", 8], ["direct", 9], ["whatsapp", 5]],
  recurring: [
    { name: "Suscripción diseño 3D", category: "software", amountCents: 2299, counterparty: "Fusion Studio", day: 5 },
    { name: "Tienda online", category: "software", amountCents: 2900, counterparty: "Tiendify", day: 12 },
    { name: "Parte del alquiler del taller", category: "rent", amountCents: 18000, counterparty: "Naves Poblenou", day: 1 },
    { name: "Anuncios Etsy", category: "marketing", amountCents: 3500, counterparty: "Etsy Ads", day: 20 },
  ],
  jobNames: ["set_cherry61_plate", "set_tkl87_plate", "artisan_dragon_x6", "artisan_montana_x6", "artisan_gato_x6", "spacebar_625_x4", "flechas_translucidas_x5", "escape_silk_x9", "reposamunecas_tpu", "extractor_x8", "expositor_12"],
};

const FIGURAS: CompanySpec = {
  seed: 20260202,
  slug: "figuras",
  name: "Figuras",
  activity: "Figuras y miniaturas impresas en resina",
  prefix: "FIG",
  monogram: "FI",
  months: 3,
  electricity: "fixed",
  customers: 15,
  ordersPerWeekStart: 1.2,
  ordersPerWeekEnd: 3.4,
  jobsPerMachineDay: 0.5,
  supplier: "Resinas del Vallès",
  machines: [
    { name: "Elegoo Saturn 4 Ultra", brand: "Elegoo", model: "Saturn 4 Ultra", technology: "resin", powerPrintW: 95, powerIdleW: 10, priceCents: 43900, boughtMonthsAgo: 3, connection: "simulator", material: 0 },
    { name: "Elegoo Mars 5 Ultra", brand: "Elegoo", model: "Mars 5 Ultra", technology: "resin", powerPrintW: 60, powerIdleW: 8, priceCents: 28900, boughtMonthsAgo: 2, connection: "none", material: 1 },
  ],
  materials: [
    { name: "Resina estándar Gris", kind: "resin", materialType: "Resina estándar", brand: "Elegoo", colorName: "Gris", colorHex: "#8a8d91", unit: "ml", packSize: 1000, packCostCents: 2390, threshold: 700 },
    { name: "Resina ABS-like Negra", kind: "resin", materialType: "Resina ABS-like", brand: "Sunlu", colorName: "Negro", colorHex: "#16171a", unit: "ml", packSize: 1000, packCostCents: 2890, threshold: 700, endStock: 420 },
    { name: "Alcohol isopropílico 99 %", kind: "consumable", unit: "ml", packSize: 5000, packCostCents: 2450, threshold: 1500 },
    { name: "Lámina FEP 9\"", kind: "consumable", unit: "ud", packSize: 5, packCostCents: 3200, threshold: 2 },
    { name: "Guantes de nitrilo", kind: "consumable", unit: "ud", packSize: 100, packCostCents: 990, threshold: 30 },
    { name: "Caja acolchada 15 cm", kind: "packaging", unit: "ud", packSize: 50, packCostCents: 3250, threshold: 20 },
  ],
  products: [
    { name: "Caballero errante 32 mm", sku: "FIG-CAB-32", category: "Miniaturas", priceCents: 1290, material: 0, materialQty: 14, printMinutes: 150, laborMinutes: 12, packagingCents: 65, batch: 8, weight: 10 },
    { name: "Hechicera del pantano 32 mm", sku: "FIG-HEC-32", category: "Miniaturas", priceCents: 1290, material: 0, materialQty: 13, printMinutes: 150, laborMinutes: 12, packagingCents: 65, batch: 8, weight: 9 },
    { name: "Escuadra de goblins (5)", sku: "FIG-GOB-5", category: "Miniaturas", priceCents: 2490, material: 0, materialQty: 38, printMinutes: 170, laborMinutes: 20, packagingCents: 65, batch: 4, weight: 7 },
    { name: "Dragón joven 120 mm", sku: "FIG-DRG-120", category: "Monstruos", priceCents: 4990, material: 1, materialQty: 165, printMinutes: 420, laborMinutes: 35, packagingCents: 65, batch: 1, weight: 5 },
    { name: "Busto de la guardiana 1:10", sku: "FIG-BUS-GUA", category: "Bustos", priceCents: 3890, material: 1, materialQty: 120, printMinutes: 360, laborMinutes: 30, packagingCents: 65, batch: 1, weight: 4 },
    { name: "Peanas texturizadas (10)", sku: "FIG-PEA-10", category: "Accesorios", priceCents: 990, material: 0, materialQty: 30, printMinutes: 95, laborMinutes: 6, packagingCents: 30, batch: 6, weight: 6 },
    { name: "Ruinas modulares · set básico", sku: "FIG-RUI-01", category: "Escenografía", priceCents: 3290, material: 0, materialQty: 210, printMinutes: 480, laborMinutes: 18, packagingCents: 65, batch: 1, weight: 3 },
  ],
  channels: [["etsy", 40], ["web", 25], ["instagram", 20], ["direct", 15]],
  recurring: [
    { name: "Licencias de modelos (mecenazgo)", category: "software", amountCents: 3000, counterparty: "Forja de Miniaturas", day: 3 },
    { name: "Anuncios Instagram", category: "marketing", amountCents: 4000, counterparty: "Meta Ads", day: 15 },
  ],
  jobNames: ["caballeros_x8", "hechiceras_x8", "goblins_x4", "dragon_joven", "busto_guardiana", "peanas_x6", "ruinas_basico"],
};

const FAILURES = ["Atasco de filamento detectado", "La primera capa no se adhirió a la cama", "Pieza despegada a mitad de impresión", "Corte de luz durante la impresión", "Soportes rotos: pieza deformada"];
const RESIN_FAILURES = ["Pieza despegada de la plataforma", "Lámina FEP perforada", "Capas sin curar por resina fría"];

async function isEmptyCompany(db: Db | Tx, companyId: string): Promise<boolean> {
  const [[m], [o], [t], [p]] = await Promise.all([
    db.select({ n: count() }).from(machines).where(eq(machines.companyId, companyId)),
    db.select({ n: count() }).from(orders).where(eq(orders.companyId, companyId)),
    db.select({ n: count() }).from(transactions).where(eq(transactions.companyId, companyId)),
    db.select({ n: count() }).from(products).where(eq(products.companyId, companyId)),
  ]);
  return m.n + o.n + t.n + p.n === 0;
}

/* ------------------------------ Generador ------------------------------ */

async function seedCompany(tx: Tx, spec: CompanySpec, today: string, timeZone: string): Promise<void> {
  const rng = mulberry32(spec.seed);
  const [existing] = await tx.select().from(companies).where(eq(companies.slug, spec.slug)).limit(1);
  if (existing && !(await isEmptyCompany(tx, existing.id))) return;

  const base: Company = existing ?? (await createCompany(tx, { name: spec.name, activity: spec.activity }));
  const [company] = await tx
    .update(companies)
    .set({
      activity: base.activity ?? spec.activity,
      description: DEMO_MARKER,
      monogram: spec.monogram,
      orderPrefix: spec.prefix,
      electricityMode: spec.electricity,
      kwhPrice: 0.168,
      kwhPricePeak: 0.224,
      kwhPriceFlat: 0.152,
      kwhPriceValley: 0.098,
    })
    .where(eq(companies.id, base.id))
    .returning();
  const companyId = company.id;
  const start = addDays(today, -Math.round(spec.months * 30.4));
  const dayCount = diffDays(start, today);
  const at = (dateISO: string, hour: number, minute = 0) => new Date(startOfDayInZone(dateISO, timeZone).getTime() + (hour * 60 + minute) * 60_000);

  /* Materiales: empiezan vacíos; cada entrada es una compra con su gasto. */
  const mats: Material[] = await tx
    .insert(materials)
    .values(
      spec.materials.map((m) => ({
        companyId,
        name: m.name,
        kind: m.kind,
        materialType: m.materialType ?? null,
        brand: m.brand ?? null,
        colorName: m.colorName ?? null,
        colorHex: m.colorHex ?? null,
        unit: m.unit,
        packSize: m.packSize,
        packCostCents: m.packCostCents,
        lowStockThreshold: m.threshold,
        supplier: spec.supplier,
        stockQty: 0,
      })),
    )
    .returning();
  const stock = mats.map(() => 0);
  const buy = async (index: number, packs: number, date: string) => {
    const m = spec.materials[index];
    await applyMaterialMovement(tx, {
      companyId,
      materialId: mats[index].id,
      type: "purchase",
      qty: packs * m.packSize,
      totalCostCents: Math.round(packs * m.packCostCents * (0.97 + rng() * 0.06)),
      date,
      supplier: spec.supplier,
    });
    stock[index] += packs * m.packSize;
  };
  for (let i = 0; i < mats.length; i++) await buy(i, spec.materials[i].kind === "packaging" ? 2 : 3, start);

  /* Máquinas */
  const machineRows: Machine[] = [];
  for (const [i, m] of spec.machines.entries()) {
    const purchaseDate = addDays(today, -Math.round(m.boughtMonthsAgo * 30.4));
    const [row] = await tx
      .insert(machines)
      .values({
        companyId,
        name: m.name,
        brand: m.brand,
        model: m.model,
        technology: m.technology,
        status: m.status ?? "active",
        location: i < 3 ? "Taller · estantería A" : "Taller · mesa",
        powerPrintW: m.powerPrintW,
        powerIdleW: m.powerIdleW,
        purchasePriceCents: m.priceCents,
        purchaseDate,
        lifespanHours: m.technology === "resin" ? 3000 : 6000,
        connectionType: m.connection,
        connectionConfig: m.connection === "simulator" ? { speed: 60 } : {},
        loadedMaterialId: mats[m.material].id,
        sortOrder: i,
      })
      .returning();
    machineRows.push(row);
    await syncMachinePurchaseExpense(tx, row, purchaseDate >= start);
  }

  /* Productos */
  const prods: Product[] = await tx
    .insert(products)
    .values(
      spec.products.map((p) => ({
        companyId,
        name: p.name,
        sku: p.sku,
        category: p.category,
        priceCents: p.priceCents,
        materialId: mats[p.material].id,
        materialQty: p.materialQty,
        printMinutes: p.printMinutes / p.batch,
        laborMinutes: p.laborMinutes,
        packagingCostCents: p.packagingCents,
        machineId: machineRows[0].id,
        stockQty: 0,
        lowStockThreshold: p.batch > 1 ? 4 : 1,
      })),
    )
    .returning();

  /* Clientes */
  const usedNames = new Set<string>();
  const customerValues = Array.from({ length: spec.customers }, (_, i) => {
    let name = "";
    do name = `${pick(rng, FIRST)} ${pick(rng, LAST)} ${pick(rng, LAST)}`;
    while (usedNames.has(name));
    usedNames.add(name);
    const [city, postalCode, province, country] = i < spec.customers - 3 ? CITIES[int(rng, 0, 9)] : CITIES[10 + (i % 3)];
    const handle = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(" ").slice(0, 2).join(".");
    return {
      companyId,
      name,
      email: `${handle}@correo.example`,
      phone: country === "España" ? `6${int(rng, 10, 99)} ${int(rng, 100, 999)} ${int(rng, 100, 999)}` : null,
      addressLine: `${pick(rng, STREETS)}, ${int(rng, 1, 180)}`,
      postalCode,
      city,
      province,
      country,
    };
  });
  const custs = await tx.insert(customers).values(customerValues).returning();

  /* Impresiones: generan stock de producto, consumo de material, horas y energía. */
  const activeMachines = machineRows.filter((_, i) => (spec.machines[i].status ?? "active") === "active");
  for (let d = 0; d <= dayCount - 1; d++) {
    const date = addDays(start, d);
    for (const machine of activeMachines) {
      if (rng() > spec.jobsPerMachineDay * (0.7 + (d / dayCount) * 0.6)) continue;
      const pIndex = weighted(rng, spec.products.map((p, i) => [i, p.weight] as const));
      const p = spec.products[pIndex];
      const failed = rng() < 0.065;
      const cancelled = !failed && rng() < 0.02;
      const fraction = failed || cancelled ? 0.15 + rng() * 0.6 : 1;
      const durationSec = Math.round(p.printMinutes * 60 * fraction * (0.95 + rng() * 0.1));
      const used = Math.round(p.materialQty * p.batch * fraction * (1.02 + rng() * 0.06));
      if (stock[p.material] < used + spec.materials[p.material].threshold * 0.5) await buy(p.material, int(rng, 2, 4), date);
      stock[p.material] -= used;
      const startedAt = at(date, int(rng, 7, 21), int(rng, 0, 59));
      const job = await startPrintJob(tx, {
        companyId,
        machineId: machine.id,
        name: `${pick(rng, spec.jobNames)}_v${int(rng, 1, 4)}`,
        fileName: `${spec.products[pIndex].sku.toLowerCase()}.${machine.technology === "resin" ? "ctb" : "3mf"}`,
        source: machine.connectionType === "none" ? "manual" : "live",
        startedAt,
        materialId: mats[p.material].id,
        productId: prods[pIndex].id,
        estimatedSec: Math.round(p.printMinutes * 60),
      });
      await finishPrintJob(tx, {
        companyId,
        jobId: job.id,
        status: failed ? "failed" : cancelled ? "cancelled" : "completed",
        endedAt: new Date(startedAt.getTime() + durationSec * 1000),
        durationSec,
        materialUsed: used,
        piecesProduced: failed || cancelled ? 0 : p.batch,
        piecesFailed: failed ? p.batch : 0,
        errorMessage: failed ? pick(rng, machine.technology === "resin" ? RESIN_FAILURES : FAILURES) : null,
        timeZone,
      });
      if (failed || cancelled) await tx.update(printJobs).set({ progress: Math.round(fraction * 100) }).where(eq(printJobs.id, job.id));
    }
  }

  /* Pedidos y envíos */
  const carriers = ["correos", "seur", "gls", "mrw", "inpost"];
  for (let d = 0; d <= dayCount; d++) {
    const date = addDays(start, d);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const perWeek = spec.ordersPerWeekStart + (spec.ordersPerWeekEnd - spec.ordersPerWeekStart) * (d / dayCount);
    const expected = (perWeek / 7) * (weekday === 0 || weekday === 6 ? 1.35 : 0.9);
    // Los dos últimos días siempre dejan trabajo abierto que enseñar.
    const forced: OrderStatus[] = d === dayCount ? ["pending", "in_production", "pending"] : d === dayCount - 1 ? ["ready", "in_production"] : [];
    let n = Math.max(forced.length, Math.floor(expected) + (rng() < expected % 1 ? 1 : 0));
    let k = 0;
    while (n-- > 0) {
      const age = dayCount - d;
      const customer = pick(rng, custs);
      const channel = weighted(rng, spec.channels);
      const lines = Array.from({ length: weighted(rng, [[1, 55], [2, 30], [3, 15]] as const) }, () => {
        const i = weighted(rng, spec.products.map((p, idx) => [idx, p.weight] as const));
        return { product: prods[i], quantity: spec.products[i].priceCents < 2000 ? int(rng, 1, 3) : 1 };
      });
      const items = lines.map((l) => ({ quantity: l.quantity, unitPriceCents: l.product.priceCents }));
      const subtotal = items.reduce((a, i) => a + i.quantity * i.unitPriceCents, 0);
      const abroad = customer.country !== "España";
      const shippingChargedCents = subtotal >= 5000 && !abroad ? 0 : abroad ? 990 : 450;
      const discountCents = rng() < 0.12 ? Math.round((subtotal * 0.1) / 10) * 10 : 0;
      const totals = computeOrderTotals({ items, discountCents, shippingChargedCents });
      const feesCents = channel === "etsy" ? Math.round(totals.totalCents * 0.095 + 30) : channel === "web" ? Math.round(totals.totalCents * 0.019 + 25) : 0;

      let status: OrderStatus;
      if (rng() < 0.035) status = "cancelled";
      else if (age > 12) status = rng() < 0.02 ? "returned" : "delivered";
      else if (age > 6) status = weighted(rng, [["delivered", 6], ["shipped", 3], ["ready", 1]] as const);
      else if (age > 2) status = weighted(rng, [["shipped", 4], ["ready", 3], ["in_production", 3]] as const);
      else status = weighted(rng, [["pending", 5], ["in_production", 4], ["ready", 1]] as const);
      if (forced[k]) status = forced[k];
      k += 1;
      const prepaid = channel !== "direct" && channel !== "whatsapp";
      const paid = status === "returned" ? false : status === "cancelled" ? false : prepaid || status === "delivered" || rng() < 0.5;

      const [order] = await tx
        .insert(orders)
        .values({
          companyId,
          number: await nextOrderNumber(tx, companyId),
          customerId: customer.id,
          customerName: customer.name,
          channel,
          status,
          paymentStatus: status === "returned" ? "refunded" : paid ? "paid" : "unpaid",
          paymentMethod: paid ? (channel === "etsy" ? "platform" : channel === "direct" ? pick(rng, ["cash", "bizum"] as const) : channel === "whatsapp" || channel === "wallapop" || channel === "instagram" ? "bizum" : "card") : null,
          orderDate: date,
          dueDate: addDays(date, int(rng, 4, 9)),
          paidAt: paid ? date : null,
          discountCents,
          shippingChargedCents,
          feesCents: paid ? feesCents : 0,
          ...totals,
          vatRatePct: company.vatRatePct,
          shipName: customer.name,
          shipAddressLine: customer.addressLine,
          shipPostalCode: customer.postalCode,
          shipCity: customer.city,
          shipProvince: customer.province,
          shipCountry: customer.country,
        })
        .returning();
      await tx.insert(orderItems).values(
        lines.map((l, i) => ({
          orderId: order.id,
          productId: l.product.id,
          description: l.product.name,
          quantity: l.quantity,
          unitPriceCents: l.product.priceCents,
          totalCents: l.quantity * l.product.priceCents,
          sortOrder: i,
        })),
      );
      await syncOrderEffects(tx, companyId, order.id);

      if (status === "shipped" || status === "delivered" || status === "returned") {
        const shippedAt = addDays(date, Math.min(age, int(rng, 1, 3)));
        const transit = abroad ? int(rng, 4, 8) : int(rng, 1, 3);
        const delivered = status !== "shipped";
        const carrier = abroad ? "dhl" : pick(rng, carriers);
        let shipmentStatus: ShipmentStatus = delivered ? (status === "returned" ? "returned" : "delivered") : rng() < 0.7 ? "in_transit" : "out_for_delivery";
        if (!delivered && rng() < 0.08) shipmentStatus = "incident";
        const [shipment] = await tx
          .insert(shipments)
          .values({
            companyId,
            orderId: order.id,
            carrier,
            service: abroad ? "Express Worldwide" : pick(rng, ["Estándar 48 h", "Urgente 24 h", "Punto de recogida"]),
            trackingNumber: `${carrier.slice(0, 2).toUpperCase()}${int(rng, 100000000, 999999999)}ES`,
            status: shipmentStatus,
            costCents: abroad ? int(rng, 890, 1490) : int(rng, 320, 590),
            weightG: int(rng, 60, 480),
            recipientName: customer.name,
            destination: `${customer.city}, ${customer.country}`,
            shippedAt,
            estimatedDelivery: addDays(shippedAt, transit),
            deliveredAt: delivered ? (addDays(shippedAt, transit) > today ? today : addDays(shippedAt, transit)) : null,
          })
          .returning();
        await syncShipmentExpense(tx, shipment, { fallbackDate: shippedAt, orderNumber: order.number });
      }
    }
  }

  /* Mantenimiento */
  const maintenance: ReadonlyArray<readonly [string, MaintenanceType, number]> =
    spec.machines[0].technology === "resin"
      ? [["Cambio de lámina FEP", "preventive", 640], ["Limpieza de cuba y filtrado de resina", "cleaning", 0], ["Nivelado de plataforma", "calibration", 0]]
      : [["Cambio de boquilla 0,4 mm", "preventive", 1290], ["Lubricación de ejes y limpieza", "cleaning", 0], ["Calibración de flujo y nivelación", "calibration", 0], ["Sustitución de correa X", "repair", 1850], ["Cambio de placa PEI texturizada", "upgrade", 3490]];
  for (const [i, machine] of machineRows.entries()) {
    const logs = int(rng, 1, 3);
    for (let k = 0; k < logs; k++) {
      const [title, type, cost] = pick(rng, maintenance);
      const date = addDays(start, int(rng, 5, Math.max(6, dayCount - 3)));
      const [log] = await tx
        .insert(maintenanceLogs)
        .values({
          companyId,
          machineId: machine.id,
          date,
          type,
          title,
          costCents: cost,
          // La primera máquina tiene una revisión vencida para que la demo lo muestre.
          nextDueDate: k === 0 ? (i === 0 ? addDays(today, -6) : addDays(today, int(rng, 10, 70))) : null,
        })
        .returning();
      await syncMaintenanceExpense(tx, log, machine.name);
    }
  }

  /* Gastos recurrentes y movimientos manuales */
  await tx.insert(recurringExpenses).values(
    spec.recurring.map((r) => ({
      companyId,
      name: r.name,
      category: r.category,
      amountCents: r.amountCents,
      startDate: `${monthOf(start)}-${String(r.day).padStart(2, "0")}`,
      counterparty: r.counterparty,
    })),
  );
  await generateRecurringCharges(tx, companyId, today);
  const manual: Array<[string, string, number, "expense" | "income", string]> = [
    ["Stand en feria maker", "marketing", 12000, "expense", "Maker Faire"],
    ["Juego de herramientas y pinzas", "other_expense", 4590, "expense", "Ferretería Roca"],
    ["Sesión de fotos de producto", "marketing", 9000, "expense", "Estudio Lumen"],
    ["Cuota de autónomos (parte)", "taxes", 8700, "expense", "Seguridad Social"],
    ["Diseño de piezas a medida", "services", 18000, "income", "Cliente particular"],
    ["Taller de impresión 3D", "services", 24000, "income", "Ateneu de Fabricació"],
  ];
  await tx.insert(transactions).values(
    manual.slice(0, spec.months >= 6 ? 6 : 4).map(([description, category, amountCents, type, counterparty], i) => ({
      companyId,
      type,
      category,
      amountCents,
      date: addDays(start, Math.round(((i + 1) / 7) * dayCount)),
      description,
      counterparty,
      paymentMethod: "transfer" as const,
    })),
  );
  // Un mes flojo al principio: una reparación cara que deja el mes en pérdidas.
  await tx.insert(transactions).values({
    companyId,
    type: "expense",
    category: "maintenance",
    amountCents: spec.months >= 6 ? 64000 : 21000,
    date: addDays(start, 18),
    description: "Reparación urgente de electrónica",
    counterparty: "Servicio técnico 3D",
    paymentMethod: "card",
  });

  /* Facturas de luz: consumo de impresión + resto del taller. */
  const firstMonth = monthOf(start);
  for (let m = firstMonth; m < monthOf(today); m = addMonths(m, 1)) {
    const range = monthRange(m);
    const [{ kwh }] = await tx
      .select({ kwh: sum(printJobs.energyKwh) })
      .from(printJobs)
      .where(and(eq(printJobs.companyId, companyId), eq(monthKeyOf(), m)));
    const totalKwh = Math.round((kwh * 1.55 + 38 + rng() * 14) * 10) / 10;
    const [bill] = await tx
      .insert(energyBills)
      .values({
        companyId,
        periodStart: range.from,
        periodEnd: range.to,
        kwh: totalKwh,
        amountCents: Math.round(totalKwh * 17.2 + 1450),
        provider: "Energía Clara",
      })
      .returning();
    await syncEnergyBillExpense(tx, bill);
  }

  /* Ajuste final de existencias para que la demo enseñe avisos reales. */
  for (const [i, m] of spec.materials.entries()) {
    const [current] = await tx.select({ stockQty: materials.stockQty }).from(materials).where(eq(materials.id, mats[i].id));
    if (m.endStock !== undefined) {
      const delta = m.endStock - current.stockQty;
      if (delta !== 0) await applyMaterialMovement(tx, { companyId, materialId: mats[i].id, type: "adjustment", qty: delta, date: today, note: "Recuento de inventario" });
    } else if (current.stockQty < m.threshold * 1.3) {
      await buy(i, 3, addDays(today, -int(rng, 1, 5)));
    }
  }
}

/** 'YYYY-MM' del inicio de la impresión (expresión SQL). */
function monthKeyOf() {
  return sql<string>`to_char(${printJobs.startedAt}, 'YYYY-MM')`;
}

export async function seedDemoData(): Promise<void> {
  const db = await getDb();
  const org = await getOrgSettings();
  const today = todayISO(org.timeZone);
  for (const spec of [TECLAS, FIGURAS]) {
    await db.transaction((tx) => seedCompany(tx, spec, today, org.timeZone));
  }
}

/** Borra las empresas de demostración (solo las marcadas por el generador). */
export async function removeDemoData(): Promise<number> {
  const db = await getDb();
  const rows = await db
    .delete(companies)
    .where(and(inArray(companies.slug, [...DEMO_SLUGS]), eq(companies.description, DEMO_MARKER)))
    .returning({ id: companies.id });
  return rows.length;
}
