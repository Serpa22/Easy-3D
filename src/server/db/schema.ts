/**
 * Esquema de base de datos (PostgreSQL vía Drizzle).
 *
 * Convenciones:
 *  - Dinero SIEMPRE en céntimos enteros (`...Cents`). Nunca decimales.
 *  - Cantidades físicas y tarifas (gramos, kWh, €/kWh) en `doublePrecision`.
 *  - Toda tabla de negocio lleva `companyId`: las sub-empresas están aisladas
 *    y TODA consulta debe filtrar por empresa.
 *  - Fechas contables como `date` (cadena 'YYYY-MM-DD'); instantes como
 *    `timestamp with time zone`.
 */
import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  CONNECTION_TYPES,
  DOCUMENT_KINDS,
  DOCUMENT_STATUSES,
  ELECTRICITY_MODES,
  MACHINE_EVENT_TYPES,
  MACHINE_STATUSES,
  MAINTENANCE_TYPES,
  MATERIAL_KINDS,
  MATERIAL_UNITS,
  MOVEMENT_TYPES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PRINTER_STATES,
  PRINT_JOB_STATUSES,
  RECURRING_FREQUENCIES,
  SALES_CHANNELS,
  SHIPMENT_STATUSES,
  TECHNOLOGIES,
  TRANSACTION_SOURCES,
  TRANSACTION_TYPES,
  USER_ROLES,
} from "../../lib/domain";
import type { DocumentParty } from "../../lib/documents";
import type { PrinterTelemetry } from "../../lib/telemetry";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* =============================== Acceso =============================== */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: USER_ROLES }).notNull().default("member"),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 del token de la cookie (el token en claro nunca se guarda). */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Ajustes globales clave/valor (nombre de la organización, zona horaria…). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

/* ============================== Empresas ============================== */

export const companies = pgTable("companies", {
  id: id(),
  name: text("name").notNull(),
  /** Identificador en la URL: /e/<slug> */
  slug: text("slug").notNull().unique(),
  /** A qué se dedica: «Teclas para teclados», «Figuras»… */
  activity: text("activity"),
  description: text("description"),
  /** 1–3 letras que se muestran como monograma. */
  monogram: text("monogram"),

  /* Fiscalidad y pedidos */
  vatRatePct: doublePrecision("vat_rate_pct").notNull().default(21),
  orderPrefix: text("order_prefix").notNull().default("P"),
  orderSeq: integer("order_seq").notNull().default(0),

  /* Electricidad */
  electricityMode: text("electricity_mode", { enum: ELECTRICITY_MODES }).notNull().default("fixed"),
  /** €/kWh con tarifa fija. */
  kwhPrice: doublePrecision("kwh_price").notNull().default(0.16),
  /** €/kWh por periodo con tarifa 2.0TD. */
  kwhPricePeak: doublePrecision("kwh_price_peak").notNull().default(0.22),
  kwhPriceFlat: doublePrecision("kwh_price_flat").notNull().default(0.15),
  kwhPriceValley: doublePrecision("kwh_price_valley").notNull().default(0.1),

  /* Parámetros para el cálculo de costes */
  laborRateCents: integer("labor_rate_cents").notNull().default(1500), // €/hora de mano de obra
  targetMarginPct: doublePrecision("target_margin_pct").notNull().default(60),
  failureRatePct: doublePrecision("failure_rate_pct").notNull().default(5),

  /* Datos fiscales del emisor (salen en facturas, presupuestos y albaranes) */
  /** Razón social o nombre y apellidos del titular. */
  legalName: text("legal_name"),
  /** NIF / CIF. */
  taxId: text("tax_id"),
  fiscalAddressLine: text("fiscal_address_line"),
  fiscalPostalCode: text("fiscal_postal_code"),
  fiscalCity: text("fiscal_city"),
  fiscalProvince: text("fiscal_province"),
  fiscalCountry: text("fiscal_country").default("España"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  website: text("website"),
  /** Cuenta para cobros por transferencia. */
  iban: text("iban"),
  /** Retención de IRPF por defecto en facturas (0 = sin retención). */
  irpfRatePct: doublePrecision("irpf_rate_pct").notNull().default(0),

  /* Series y textos de los documentos */
  invoicePrefix: text("invoice_prefix").notNull().default("F"),
  rectifyingPrefix: text("rectifying_prefix").notNull().default("R"),
  quotePrefix: text("quote_prefix").notNull().default("PRE"),
  deliveryPrefix: text("delivery_prefix").notNull().default("ALB"),
  /** Días de validez de un presupuesto. */
  quoteValidityDays: integer("quote_validity_days").notNull().default(30),
  /** Días hasta el vencimiento de una factura (0 = al contado). */
  paymentTermsDays: integer("payment_terms_days").notNull().default(0),
  /** Condiciones que se proponen por defecto en los presupuestos. */
  quoteTerms: text("quote_terms"),
  /** Pie de página: inscripción registral, protección de datos… */
  documentFooter: text("document_footer"),

  /**
   * Empresa creada por «Cargar datos de ejemplo»: qué empresa de demostración es
   * («teclas», «figuras»). Solo la escribe el generador de datos de ejemplo
   * (ningún formulario la toca) y es lo ÚNICO que autoriza a «Eliminar datos de
   * ejemplo» a borrar una empresa. null = empresa real.
   */
  demoKey: text("demo_key"),

  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/* ============================= Maquinaria ============================= */

/** Programa «bridge» que corre en el taller y reenvía la telemetría. */
export const bridges = pgTable("bridges", {
  id: id(),
  name: text("name").notNull(),
  /** SHA-256 del token; el token solo se muestra una vez al crearlo. */
  tokenHash: text("token_hash").notNull().unique(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  version: text("version"),
  createdAt: createdAt(),
});

export const machines = pgTable(
  "machines",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    brand: text("brand"),
    model: text("model"),
    technology: text("technology", { enum: TECHNOLOGIES }).notNull().default("fdm"),
    serialNumber: text("serial_number"),
    status: text("status", { enum: MACHINE_STATUSES }).notNull().default("active"),
    location: text("location"),
    notes: text("notes"),

    /* Consumo eléctrico estimado */
    powerPrintW: doublePrecision("power_print_w").notNull().default(120),
    powerIdleW: doublePrecision("power_idle_w").notNull().default(8),

    /* Amortización */
    purchasePriceCents: integer("purchase_price_cents"),
    purchaseDate: date("purchase_date", { mode: "string" }),
    lifespanHours: integer("lifespan_hours").notNull().default(5000),

    /* Contadores */
    totalPrintSeconds: integer("total_print_seconds").notNull().default(0),

    /* Conexión en directo */
    connectionType: text("connection_type", { enum: CONNECTION_TYPES }).notNull().default("none"),
    /**
     * Datos de conexión (host, claves…). SECRETO: nunca se envía al navegador;
     * usa los helpers de `server/printers/config` para leerlo o enmascararlo.
     */
    connectionConfig: jsonb("connection_config").$type<Record<string, unknown>>().notNull().default({}),
    /** null = conecta el propio servidor; si no, la conecta ese bridge. */
    bridgeId: uuid("bridge_id").references(() => bridges.id, { onDelete: "set null" }),

    /** Material cargado ahora mismo: se descuenta al terminar una impresión. */
    loadedMaterialId: uuid("loaded_material_id").references((): AnyPgColumn => materials.id, { onDelete: "set null" }),

    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("machines_company_idx").on(t.companyId)],
);

/** Último estado conocido de cada máquina (una fila por máquina). */
export const machineLive = pgTable("machine_live", {
  machineId: uuid("machine_id")
    .primaryKey()
    .references(() => machines.id, { onDelete: "cascade" }),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  state: text("state", { enum: PRINTER_STATES }).notNull().default("offline"),
  telemetry: jsonb("telemetry").$type<PrinterTelemetry>(),
  currentJobId: uuid("current_job_id"),
  /**
   * Lo último que se supo de la impresión en curso y cuándo. Sobrevive a los
   * cortes de conexión (la telemetría «sin conexión» no trae datos del trabajo)
   * y permite cerrar la impresión con SUS datos, no con los de la siguiente.
   */
  lastJob: jsonb("last_job").$type<{ at: string; facts: NonNullable<PrinterTelemetry["job"]> }>(),
  /** Última telemetría recibida. */
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  /** Desde cuándo está en el estado actual. */
  stateSince: timestamp("state_since", { withTimezone: true }),
});

export const machineEvents = pgTable(
  "machine_events",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    machineId: uuid("machine_id")
      .notNull()
      .references(() => machines.id, { onDelete: "cascade" }),
    type: text("type", { enum: MACHINE_EVENT_TYPES }).notNull(),
    message: text("message").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    printJobId: uuid("print_job_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("machine_events_machine_idx").on(t.machineId, t.createdAt),
    index("machine_events_company_idx").on(t.companyId, t.createdAt),
  ],
);

export const maintenanceLogs = pgTable(
  "maintenance_logs",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    machineId: uuid("machine_id")
      .notNull()
      .references(() => machines.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    type: text("type", { enum: MAINTENANCE_TYPES }).notNull().default("preventive"),
    title: text("title").notNull(),
    description: text("description"),
    costCents: integer("cost_cents").notNull().default(0),
    /** Próxima revisión prevista. */
    nextDueDate: date("next_due_date", { mode: "string" }),
    createdAt: createdAt(),
  },
  (t) => [index("maintenance_machine_idx").on(t.machineId, t.date)],
);

/* ============================= Materiales ============================= */

export const materials = pgTable(
  "materials",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: MATERIAL_KINDS }).notNull().default("filament"),
    /** PLA, PETG, ABS, TPU, resina estándar… */
    materialType: text("material_type"),
    brand: text("brand"),
    colorName: text("color_name"),
    /** #RRGGBB */
    colorHex: text("color_hex"),
    unit: text("unit", { enum: MATERIAL_UNITS }).notNull().default("g"),
    /** Existencias actuales, en `unit`. */
    stockQty: doublePrecision("stock_qty").notNull().default(0),
    /** Tamaño del envase (bobina de 1000 g, botella de 500 ml…). */
    packSize: doublePrecision("pack_size").notNull().default(1000),
    /** Precio del envase (última compra), IVA incluido. */
    packCostCents: integer("pack_cost_cents").notNull().default(0),
    /** Aviso de stock bajo cuando `stockQty` baja de aquí. */
    lowStockThreshold: doublePrecision("low_stock_threshold").notNull().default(0),
    supplier: text("supplier"),
    location: text("location"),
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("materials_company_idx").on(t.companyId)],
);

export const materialMovements = pgTable(
  "material_movements",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    type: text("type", { enum: MOVEMENT_TYPES }).notNull(),
    /** Con signo: positivo entra, negativo sale. En la unidad del material. */
    qty: doublePrecision("qty").notNull(),
    /** Coste total de la compra (solo `purchase`). */
    totalCostCents: integer("total_cost_cents"),
    printJobId: uuid("print_job_id"),
    date: date("date", { mode: "string" }).notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("material_movements_material_idx").on(t.materialId, t.date),
    index("material_movements_company_idx").on(t.companyId, t.date),
  ],
);

/* ====================== Productos, clientes, pedidos ====================== */

export const products = pgTable(
  "products",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sku: text("sku"),
    category: text("category"),
    description: text("description"),
    /** Precio de venta al público, IVA incluido. */
    priceCents: integer("price_cents").notNull().default(0),

    /* Receta de fabricación por unidad (para el cálculo de costes) */
    materialId: uuid("material_id").references(() => materials.id, { onDelete: "set null" }),
    materialQty: doublePrecision("material_qty").notNull().default(0), // en la unidad del material
    printMinutes: doublePrecision("print_minutes").notNull().default(0),
    laborMinutes: doublePrecision("labor_minutes").notNull().default(0),
    packagingCostCents: integer("packaging_cost_cents").notNull().default(0),
    otherCostCents: integer("other_cost_cents").notNull().default(0),
    /** Máquina habitual: aporta consumo eléctrico y amortización. */
    machineId: uuid("machine_id").references(() => machines.id, { onDelete: "set null" }),

    /* Stock de producto terminado */
    stockQty: integer("stock_qty").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(0),

    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("products_company_idx").on(t.companyId)],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    taxId: text("tax_id"),
    addressLine: text("address_line"),
    postalCode: text("postal_code"),
    city: text("city"),
    province: text("province"),
    country: text("country").default("España"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("customers_company_idx").on(t.companyId)],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Número visible: prefijo de la empresa + secuencia («TK-0042»). */
    number: text("number").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** Copia del nombre del cliente en el momento del pedido. */
    customerName: text("customer_name").notNull(),
    channel: text("channel", { enum: SALES_CHANNELS }).notNull().default("direct"),
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("pending"),
    paymentStatus: text("payment_status", { enum: PAYMENT_STATUSES }).notNull().default("unpaid"),
    paymentMethod: text("payment_method", { enum: PAYMENT_METHODS }),
    orderDate: date("order_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }),
    paidAt: date("paid_at", { mode: "string" }),

    /* Importes (IVA incluido) */
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    discountCents: integer("discount_cents").notNull().default(0),
    /** Envío cobrado al cliente. */
    shippingChargedCents: integer("shipping_charged_cents").notNull().default(0),
    /** Comisiones de la plataforma (Etsy, PayPal…): generan un gasto. */
    feesCents: integer("fees_cents").notNull().default(0),
    /** subtotal − descuento + envío cobrado. */
    totalCents: integer("total_cents").notNull().default(0),
    vatRatePct: doublePrecision("vat_rate_pct").notNull().default(21),

    /* Dirección de envío */
    shipName: text("ship_name"),
    shipAddressLine: text("ship_address_line"),
    shipPostalCode: text("ship_postal_code"),
    shipCity: text("ship_city"),
    shipProvince: text("ship_province"),
    shipCountry: text("ship_country"),

    /** true cuando las unidades del pedido ya se han descontado del stock de producto. */
    stockDeducted: boolean("stock_deducted").notNull().default(false),

    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    index("orders_company_date_idx").on(t.companyId, t.orderDate),
    uniqueIndex("orders_company_number_idx").on(t.companyId, t.number),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    /**
     * Unidades que esta línea ha descontado realmente del stock del producto al
     * enviarse (puede ser menos que `quantity` si no había bastante). Al
     * cancelar o editar el pedido se devuelve exactamente esta cantidad.
     */
    stockDeductedQty: integer("stock_deducted_qty").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

/* =============================== Envíos =============================== */

export const shipments = pgTable(
  "shipments",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    /** Clave del transportista (ver `lib/carriers`) o texto libre. */
    carrier: text("carrier").notNull(),
    service: text("service"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    status: text("status", { enum: SHIPMENT_STATUSES }).notNull().default("pending"),
    /** Lo que nos cuesta el envío (genera un gasto). */
    costCents: integer("cost_cents").notNull().default(0),
    weightG: integer("weight_g"),
    recipientName: text("recipient_name"),
    destination: text("destination"),
    shippedAt: date("shipped_at", { mode: "string" }),
    estimatedDelivery: date("estimated_delivery", { mode: "string" }),
    deliveredAt: date("delivered_at", { mode: "string" }),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    index("shipments_company_idx").on(t.companyId, t.createdAt),
    index("shipments_order_idx").on(t.orderId),
  ],
);

/* ============================= Impresiones ============================= */

export const printJobs = pgTable(
  "print_jobs",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    machineId: uuid("machine_id").references(() => machines.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    materialId: uuid("material_id").references(() => materials.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    fileName: text("file_name"),
    status: text("status", { enum: PRINT_JOB_STATUSES }).notNull().default("printing"),
    /** «live» = detectada por la conexión con la máquina; «manual» = apuntada a mano. */
    source: text("source", { enum: ["live", "manual"] })
      .notNull()
      .default("manual"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Duración real de impresión (se fija al terminar). */
    durationSec: integer("duration_sec").notNull().default(0),
    /** Duración prevista, si se conoce (para estimar el progreso de impresiones manuales). */
    estimatedSec: integer("estimated_sec"),
    /** 0..100 (último progreso conocido). */
    progress: doublePrecision("progress").notNull().default(0),
    /** Material consumido, en la unidad del material (g / ml). */
    materialUsed: doublePrecision("material_used").notNull().default(0),
    piecesProduced: integer("pieces_produced").notNull().default(0),
    piecesFailed: integer("pieces_failed").notNull().default(0),
    energyKwh: doublePrecision("energy_kwh").notNull().default(0),
    energyCostCents: integer("energy_cost_cents").notNull().default(0),
    materialCostCents: integer("material_cost_cents").notNull().default(0),
    errorMessage: text("error_message"),
    thumbnailUrl: text("thumbnail_url"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    index("print_jobs_company_idx").on(t.companyId, t.startedAt),
    index("print_jobs_machine_idx").on(t.machineId, t.startedAt),
  ],
);

/* ============================== Finanzas ============================== */

export const recurringExpenses = pgTable(
  "recurring_expenses",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    amountCents: integer("amount_cents").notNull(),
    vatRatePct: doublePrecision("vat_rate_pct").notNull().default(21),
    frequency: text("frequency", { enum: RECURRING_FREQUENCIES }).notNull().default("monthly"),
    /** Fecha del primer cargo; los siguientes repiten el día del mes. */
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    /** Fecha del último cargo ya convertido en movimiento. */
    lastGeneratedDate: date("last_generated_date", { mode: "string" }),
    /**
     * No se generan cargos con fecha anterior a esta. Se fija al reanudar un gasto
     * en pausa (no se cobran los meses parados) y al cambiar su calendario (no se
     * cobra dos veces un periodo ya cargado).
     */
    chargeFrom: date("charge_from", { mode: "string" }),
    counterparty: text("counterparty"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("recurring_company_idx").on(t.companyId)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    type: text("type", { enum: TRANSACTION_TYPES }).notNull(),
    /** Clave de `lib/domain` (CATEGORY_LABELS). */
    category: text("category").notNull(),
    /** Importe total positivo, IVA incluido. */
    amountCents: integer("amount_cents").notNull(),
    vatRatePct: doublePrecision("vat_rate_pct").notNull().default(21),
    date: date("date", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    /** Proveedor o cliente. */
    counterparty: text("counterparty"),
    paymentMethod: text("payment_method", { enum: PAYMENT_METHODS }),
    notes: text("notes"),

    /**
     * Origen. Los movimientos no manuales los mantiene la aplicación en
     * sincronía con su registro de origen (ver `server/domain/ledger`).
     */
    sourceType: text("source_type", { enum: TRANSACTION_SOURCES }).notNull().default("manual"),
    sourceId: uuid("source_id"),
    /** Para cargos recurrentes: fecha del periodo que representan ('' si no aplica). */
    sourceKey: text("source_key").notNull().default(""),

    machineId: uuid("machine_id").references(() => machines.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("transactions_company_date_idx").on(t.companyId, t.date),
    index("transactions_company_type_idx").on(t.companyId, t.type, t.date),
    uniqueIndex("transactions_source_idx")
      .on(t.sourceType, t.sourceId, t.sourceKey)
      .where(sql`${t.sourceType} <> 'manual'`),
  ],
);

/* ============================== Energía =============================== */

/** Facturas de luz reales (para contrastar con el consumo estimado). */
export const energyBills = pgTable(
  "energy_bills",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    kwh: doublePrecision("kwh").notNull().default(0),
    amountCents: integer("amount_cents").notNull(),
    provider: text("provider"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("energy_bills_company_idx").on(t.companyId, t.periodEnd)],
);

/* ============================= Documentos ============================= */

/**
 * Facturas, rectificativas, presupuestos y albaranes. Guardan una copia de los
 * datos del emisor y del cliente tal y como estaban al emitirse: cambiar la
 * ficha del cliente después no altera un documento ya emitido.
 *
 * No generan movimientos en Finanzas: el ingreso nace al cobrar el pedido.
 */
export const documents = pgTable(
  "documents",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
    status: text("status", { enum: DOCUMENT_STATUSES }).notNull().default("issued"),

    /* Numeración: serie + año + secuencia («F2026-0007») */
    series: text("series").notNull(),
    year: integer("year").notNull(),
    seq: integer("seq").notNull(),
    number: text("number").notNull(),

    issueDate: date("issue_date", { mode: "string" }).notNull(),
    /** Vencimiento (facturas) o validez (presupuestos). */
    dueDate: date("due_date", { mode: "string" }),

    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** Factura que corrige una rectificativa. */
    rectifiesId: uuid("rectifies_id").references((): AnyPgColumn => documents.id, { onDelete: "set null" }),
    rectificationReason: text("rectification_reason"),

    issuer: jsonb("issuer").$type<DocumentParty>().notNull(),
    customer: jsonb("customer").$type<DocumentParty>().notNull(),

    /** true: los precios de las líneas llevan el IVA incluido (como los pedidos). */
    pricesIncludeVat: boolean("prices_include_vat").notNull().default(false),
    /** Albaranes: mostrar o no los importes. */
    showPrices: boolean("show_prices").notNull().default(true),
    vatRatePct: doublePrecision("vat_rate_pct").notNull().default(21),
    irpfRatePct: doublePrecision("irpf_rate_pct").notNull().default(0),

    /* Importes en céntimos (ver `lib/documents` → computeDocumentTotals) */
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    discountCents: integer("discount_cents").notNull().default(0),
    shippingCents: integer("shipping_cents").notNull().default(0),
    baseCents: integer("base_cents").notNull().default(0),
    vatCents: integer("vat_cents").notNull().default(0),
    /** Base + IVA. */
    totalCents: integer("total_cents").notNull().default(0),
    irpfCents: integer("irpf_cents").notNull().default(0),
    /** Total − retención de IRPF. */
    amountDueCents: integer("amount_due_cents").notNull().default(0),

    paymentMethod: text("payment_method", { enum: PAYMENT_METHODS }),
    /** Observaciones visibles en el documento. */
    notes: text("notes"),
    /** Condiciones (presupuestos) o forma de pago. */
    terms: text("terms"),
    footer: text("footer"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("documents_company_kind_idx").on(t.companyId, t.kind, t.issueDate),
    index("documents_order_idx").on(t.orderId),
    uniqueIndex("documents_number_idx").on(t.companyId, t.kind, t.year, t.seq),
  ],
);

export const documentItems = pgTable(
  "document_items",
  {
    id: id(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    /** Admite decimales (horas de diseño) y negativos en rectificativas. */
    quantity: doublePrecision("quantity").notNull().default(1),
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("document_items_document_idx").on(t.documentId)],
);

/** Último número usado por empresa, tipo de documento y año. */
export const documentSequences = pgTable(
  "document_sequences",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
    year: integer("year").notNull(),
    lastSeq: integer("last_seq").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.kind, t.year] })],
);

/* ============================== Relaciones ============================== */

export const companiesRelations = relations(companies, ({ many }) => ({
  machines: many(machines),
  materials: many(materials),
  products: many(products),
  customers: many(customers),
  orders: many(orders),
  shipments: many(shipments),
  transactions: many(transactions),
  printJobs: many(printJobs),
  documents: many(documents),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const machinesRelations = relations(machines, ({ one, many }) => ({
  company: one(companies, { fields: [machines.companyId], references: [companies.id] }),
  live: one(machineLive, { fields: [machines.id], references: [machineLive.machineId] }),
  bridge: one(bridges, { fields: [machines.bridgeId], references: [bridges.id] }),
  loadedMaterial: one(materials, { fields: [machines.loadedMaterialId], references: [materials.id] }),
  events: many(machineEvents),
  maintenanceLogs: many(maintenanceLogs),
  printJobs: many(printJobs),
}));

export const machineLiveRelations = relations(machineLive, ({ one }) => ({
  machine: one(machines, { fields: [machineLive.machineId], references: [machines.id] }),
}));

export const machineEventsRelations = relations(machineEvents, ({ one }) => ({
  machine: one(machines, { fields: [machineEvents.machineId], references: [machines.id] }),
}));

export const maintenanceLogsRelations = relations(maintenanceLogs, ({ one }) => ({
  machine: one(machines, { fields: [maintenanceLogs.machineId], references: [machines.id] }),
}));

export const materialsRelations = relations(materials, ({ one, many }) => ({
  company: one(companies, { fields: [materials.companyId], references: [companies.id] }),
  movements: many(materialMovements),
}));

export const materialMovementsRelations = relations(materialMovements, ({ one }) => ({
  material: one(materials, { fields: [materialMovements.materialId], references: [materials.id] }),
  printJob: one(printJobs, { fields: [materialMovements.printJobId], references: [printJobs.id] }),
}));

export const productsRelations = relations(products, ({ one }) => ({
  company: one(companies, { fields: [products.companyId], references: [companies.id] }),
  material: one(materials, { fields: [products.materialId], references: [materials.id] }),
  machine: one(machines, { fields: [products.machineId], references: [machines.id] }),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  company: one(companies, { fields: [orders.companyId], references: [companies.id] }),
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  items: many(orderItems),
  shipments: many(shipments),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));

export const shipmentsRelations = relations(shipments, ({ one }) => ({
  order: one(orders, { fields: [shipments.orderId], references: [orders.id] }),
}));

export const printJobsRelations = relations(printJobs, ({ one }) => ({
  machine: one(machines, { fields: [printJobs.machineId], references: [machines.id] }),
  product: one(products, { fields: [printJobs.productId], references: [products.id] }),
  order: one(orders, { fields: [printJobs.orderId], references: [orders.id] }),
  material: one(materials, { fields: [printJobs.materialId], references: [materials.id] }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  company: one(companies, { fields: [transactions.companyId], references: [companies.id] }),
  machine: one(machines, { fields: [transactions.machineId], references: [machines.id] }),
}));

/* ================================ Tipos ================================ */

export type User = typeof users.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type Bridge = typeof bridges.$inferSelect;
export type Machine = typeof machines.$inferSelect;
export type MachineLiveRow = typeof machineLive.$inferSelect;
export type MachineEvent = typeof machineEvents.$inferSelect;
export type MaintenanceLog = typeof maintenanceLogs.$inferSelect;
export type Material = typeof materials.$inferSelect;
export type MaterialMovement = typeof materialMovements.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Shipment = typeof shipments.$inferSelect;
export type PrintJob = typeof printJobs.$inferSelect;
export type RecurringExpense = typeof recurringExpenses.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type EnergyBill = typeof energyBills.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type DocumentItem = typeof documentItems.$inferSelect;
