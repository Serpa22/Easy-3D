/**
 * Vocabulario del dominio: valores permitidos y etiquetas en español.
 * Archivo isomórfico (sin imports de servidor): lo usan el esquema de BD,
 * las validaciones y la interfaz.
 */

export const USER_ROLES = ["owner", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  owner: "Propietario",
  member: "Miembro",
};

/* ----------------------------- Maquinaria ----------------------------- */

export const TECHNOLOGIES = ["fdm", "resin", "sls", "other"] as const;
export type Technology = (typeof TECHNOLOGIES)[number];
export const TECHNOLOGY_LABELS: Record<Technology, string> = {
  fdm: "FDM (filamento)",
  resin: "Resina (SLA/MSLA)",
  sls: "SLS (polvo)",
  other: "Otra",
};

/** Estado administrativo de la máquina (no el estado en directo). */
export const MACHINE_STATUSES = ["active", "maintenance", "retired"] as const;
export type MachineStatus = (typeof MACHINE_STATUSES)[number];
export const MACHINE_STATUS_LABELS: Record<MachineStatus, string> = {
  active: "Operativa",
  maintenance: "En mantenimiento",
  retired: "Retirada",
};

export const CONNECTION_TYPES = [
  "none",
  "simulator",
  "bambu",
  "moonraker",
  "octoprint",
  "prusalink",
  "elegoo",
] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];
export const CONNECTION_TYPE_LABELS: Record<ConnectionType, string> = {
  none: "Sin conexión (manual)",
  simulator: "Simulador (demo)",
  bambu: "Bambu Lab (LAN)",
  moonraker: "Klipper / Moonraker",
  octoprint: "OctoPrint",
  prusalink: "PrusaLink",
  elegoo: "Elegoo (SDCP)",
};

/** Estado en directo normalizado para cualquier impresora. */
export const PRINTER_STATES = [
  "offline",
  "idle",
  "preparing",
  "printing",
  "paused",
  "finished",
  "error",
] as const;
export type PrinterState = (typeof PRINTER_STATES)[number];
export const PRINTER_STATE_LABELS: Record<PrinterState, string> = {
  offline: "Sin conexión",
  idle: "En reposo",
  preparing: "Preparando",
  printing: "Imprimiendo",
  paused: "En pausa",
  finished: "Terminada",
  error: "Error",
};
/** Estados que cuentan como «máquina trabajando». */
export const WORKING_STATES: readonly PrinterState[] = ["preparing", "printing", "paused"];

export const PRINT_JOB_STATUSES = ["printing", "paused", "completed", "failed", "cancelled"] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];
export const PRINT_JOB_STATUS_LABELS: Record<PrintJobStatus, string> = {
  printing: "Imprimiendo",
  paused: "En pausa",
  completed: "Completada",
  failed: "Fallida",
  cancelled: "Cancelada",
};

export const MACHINE_EVENT_TYPES = [
  "online",
  "offline",
  "print_started",
  "print_paused",
  "print_resumed",
  "print_finished",
  "print_failed",
  "print_cancelled",
  "error",
  "info",
] as const;
export type MachineEventType = (typeof MACHINE_EVENT_TYPES)[number];
export const MACHINE_EVENT_LABELS: Record<MachineEventType, string> = {
  online: "Conectada",
  offline: "Desconectada",
  print_started: "Impresión iniciada",
  print_paused: "Impresión en pausa",
  print_resumed: "Impresión reanudada",
  print_finished: "Impresión terminada",
  print_failed: "Impresión fallida",
  print_cancelled: "Impresión cancelada",
  error: "Error",
  info: "Aviso",
};

export const MAINTENANCE_TYPES = ["preventive", "repair", "calibration", "cleaning", "upgrade"] as const;
export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number];
export const MAINTENANCE_TYPE_LABELS: Record<MaintenanceType, string> = {
  preventive: "Preventivo",
  repair: "Reparación",
  calibration: "Calibración",
  cleaning: "Limpieza",
  upgrade: "Mejora",
};

/* ----------------------------- Materiales ----------------------------- */

export const MATERIAL_KINDS = ["filament", "resin", "consumable", "packaging", "other"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
export const MATERIAL_KIND_LABELS: Record<MaterialKind, string> = {
  filament: "Filamento",
  resin: "Resina",
  consumable: "Consumible",
  packaging: "Embalaje",
  other: "Otro",
};

export const MATERIAL_UNITS = ["g", "ml", "ud"] as const;
export type MaterialUnit = (typeof MATERIAL_UNITS)[number];
export const MATERIAL_UNIT_LABELS: Record<MaterialUnit, string> = {
  g: "gramos",
  ml: "mililitros",
  ud: "unidades",
};

export const MOVEMENT_TYPES = ["purchase", "consumption", "adjustment", "waste"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  purchase: "Compra",
  consumption: "Consumo",
  adjustment: "Ajuste",
  waste: "Merma",
};

/* ------------------------------ Pedidos ------------------------------- */

export const ORDER_STATUSES = [
  "pending",
  "in_production",
  "ready",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pendiente",
  in_production: "En producción",
  ready: "Listo para enviar",
  shipped: "Enviado",
  delivered: "Entregado",
  cancelled: "Cancelado",
  returned: "Devuelto",
};
/** Pedidos que siguen «abiertos» (requieren trabajo). */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ["pending", "in_production", "ready"];

export const PAYMENT_STATUSES = ["unpaid", "paid", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Sin cobrar",
  paid: "Cobrado",
  refunded: "Reembolsado",
};

export const SALES_CHANNELS = [
  "web",
  "etsy",
  "wallapop",
  "instagram",
  "amazon",
  "whatsapp",
  "direct",
  "other",
] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];
export const SALES_CHANNEL_LABELS: Record<SalesChannel, string> = {
  web: "Tienda web",
  etsy: "Etsy",
  wallapop: "Wallapop",
  instagram: "Instagram",
  amazon: "Amazon",
  whatsapp: "WhatsApp",
  direct: "Venta directa",
  other: "Otro",
};

export const PAYMENT_METHODS = ["card", "transfer", "bizum", "paypal", "cash", "platform", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  card: "Tarjeta",
  transfer: "Transferencia",
  bizum: "Bizum",
  paypal: "PayPal",
  cash: "Efectivo",
  platform: "Plataforma",
  other: "Otro",
};

/* ------------------------------- Envíos ------------------------------- */

export const SHIPMENT_STATUSES = [
  "pending",
  "label_created",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "incident",
  "returned",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  pending: "Por preparar",
  label_created: "Etiqueta creada",
  in_transit: "En tránsito",
  out_for_delivery: "En reparto",
  delivered: "Entregado",
  incident: "Incidencia",
  returned: "Devuelto",
};
/** Envíos todavía en curso. */
export const ACTIVE_SHIPMENT_STATUSES: readonly ShipmentStatus[] = [
  "pending",
  "label_created",
  "in_transit",
  "out_for_delivery",
  "incident",
];

/* ------------------------------ Finanzas ------------------------------ */

export const TRANSACTION_TYPES = ["income", "expense"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  income: "Ingreso",
  expense: "Gasto",
};

export const INCOME_CATEGORIES = ["sales", "services", "refund_received", "other_income"] as const;
export const EXPENSE_CATEGORIES = [
  "materials",
  "electricity",
  "shipping",
  "machinery",
  "maintenance",
  "packaging",
  "platform_fees",
  "software",
  "marketing",
  "rent",
  "taxes",
  "salaries",
  "refund_given",
  "other_expense",
] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type TransactionCategory = IncomeCategory | ExpenseCategory;
export const TRANSACTION_CATEGORIES = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES] as const;
export const CATEGORY_LABELS: Record<TransactionCategory, string> = {
  sales: "Ventas",
  services: "Servicios",
  refund_received: "Devolución recibida",
  other_income: "Otros ingresos",
  materials: "Materiales",
  electricity: "Electricidad",
  shipping: "Envíos",
  machinery: "Maquinaria",
  maintenance: "Mantenimiento",
  packaging: "Embalaje",
  platform_fees: "Comisiones de plataforma",
  software: "Software y suscripciones",
  marketing: "Marketing",
  rent: "Alquiler",
  taxes: "Impuestos y tasas",
  salaries: "Personal",
  refund_given: "Reembolsos a clientes",
  other_expense: "Otros gastos",
};
export function categoriesFor(type: TransactionType): readonly TransactionCategory[] {
  return type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}
export function categoryLabel(category: string): string {
  return (CATEGORY_LABELS as Record<string, string>)[category] ?? category;
}

/**
 * Origen de un movimiento contable. «manual» lo crea el usuario; el resto los
 * genera la aplicación a partir de otro registro (y se mantienen sincronizados).
 */
export const TRANSACTION_SOURCES = [
  "manual",
  "order",
  "order_fee",
  "shipment",
  "material_purchase",
  "maintenance",
  "machine",
  "energy",
  "recurring",
] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];
export const TRANSACTION_SOURCE_LABELS: Record<TransactionSource, string> = {
  manual: "Manual",
  order: "Pedido",
  order_fee: "Comisión de pedido",
  shipment: "Envío",
  material_purchase: "Compra de material",
  maintenance: "Mantenimiento",
  machine: "Compra de máquina",
  energy: "Factura de luz",
  recurring: "Gasto recurrente",
};

export const RECURRING_FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];
export const RECURRING_FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  monthly: "Mensual",
  quarterly: "Trimestral",
  yearly: "Anual",
};

/* ------------------------------ Energía ------------------------------- */

/** Tarifa fija (un precio) o por periodos 2.0TD (punta / llano / valle). */
export const ELECTRICITY_MODES = ["fixed", "tou"] as const;
export type ElectricityMode = (typeof ELECTRICITY_MODES)[number];
export const ELECTRICITY_MODE_LABELS: Record<ElectricityMode, string> = {
  fixed: "Precio fijo",
  tou: "Por periodos (punta / llano / valle)",
};
export const TARIFF_PERIODS = ["peak", "flat", "valley"] as const;
export type TariffPeriod = (typeof TARIFF_PERIODS)[number];
export const TARIFF_PERIOD_LABELS: Record<TariffPeriod, string> = {
  peak: "Punta",
  flat: "Llano",
  valley: "Valle",
};

/* ----------------------------- Documentos ----------------------------- */

/** Documentos comerciales que emite una sub-empresa. */
export const DOCUMENT_KINDS = ["invoice", "rectifying", "quote", "delivery_note"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  invoice: "Factura",
  rectifying: "Factura rectificativa",
  quote: "Presupuesto",
  delivery_note: "Albarán",
};
/** Plural, para pestañas y listados. */
export const DOCUMENT_KIND_PLURAL: Record<DocumentKind, string> = {
  invoice: "Facturas",
  rectifying: "Rectificativas",
  quote: "Presupuestos",
  delivery_note: "Albaranes",
};
/** Prefijo de serie por defecto («F2026-0001»). */
export const DOCUMENT_DEFAULT_PREFIX: Record<DocumentKind, string> = {
  invoice: "F",
  rectifying: "R",
  quote: "PRE",
  delivery_note: "ALB",
};
/** Documentos con numeración fiscal: no se borran salvo el último de su serie. */
export const FISCAL_DOCUMENT_KINDS: readonly DocumentKind[] = ["invoice", "rectifying"];

/** Estado de un documento. Solo los presupuestos pasan a aceptado o rechazado. */
export const DOCUMENT_STATUSES = ["issued", "accepted", "rejected"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  issued: "Emitido",
  accepted: "Aceptado",
  rejected: "Rechazado",
};
/** Cómo se lee el estado en un presupuesto. */
export const QUOTE_STATUS_LABELS: Record<DocumentStatus, string> = {
  issued: "Pendiente",
  accepted: "Aceptado",
  rejected: "Rechazado",
};
/** Presupuesto pendiente cuya validez ya pasó. */
export const QUOTE_EXPIRED_LABEL = "Caducado";
