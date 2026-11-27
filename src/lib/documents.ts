/**
 * Cálculos y formato de documentos comerciales (facturas, rectificativas,
 * presupuestos, albaranes). Isomórfico: lo usan el servidor al guardar y el
 * formulario para la vista previa de importes, así que ambos coinciden.
 */
import type { DocumentKind } from "./domain";

/** Datos de una parte (emisor o cliente) tal y como salen impresos. */
export interface DocumentParty {
  name: string;
  taxId: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  /** Solo emisor. */
  website?: string | null;
  iban?: string | null;
}

export interface DocumentLineInput {
  quantity: number;
  unitPriceCents: number;
}

export interface DocumentTotalsInput {
  lines: DocumentLineInput[];
  discountCents: number;
  shippingCents: number;
  vatRatePct: number;
  irpfRatePct: number;
  /** true: precios con IVA incluido (el total manda y la base se deduce). */
  pricesIncludeVat: boolean;
}

export interface DocumentTotals {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  baseCents: number;
  vatCents: number;
  totalCents: number;
  irpfCents: number;
  amountDueCents: number;
}

/** Redondeo comercial simétrico: −2,5 → −3 (igual que 2,5 → 3). */
export function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value) + 1e-9);
}

export function lineTotalCents(quantity: number, unitPriceCents: number): number {
  return roundCents(quantity * unitPriceCents);
}

/**
 * Importes del documento. Con precios sin IVA: base = líneas − descuento +
 * envío; IVA = base × tipo. Con precios con IVA incluido (como los pedidos):
 * el total es exactamente esa suma y la base se obtiene descontando el IVA,
 * para que la factura de un pedido cuadre al céntimo con lo cobrado.
 * La retención de IRPF se calcula sobre la base y se resta del total a pagar.
 */
export function computeDocumentTotals(input: DocumentTotalsInput): DocumentTotals {
  const vat = Number.isFinite(input.vatRatePct) ? input.vatRatePct : 0;
  const irpf = Number.isFinite(input.irpfRatePct) ? input.irpfRatePct : 0;
  const subtotalCents = input.lines.reduce((acc, l) => acc + lineTotalCents(l.quantity, l.unitPriceCents), 0);
  const gross = subtotalCents - input.discountCents + input.shippingCents;
  let baseCents: number;
  let vatCents: number;
  let totalCents: number;
  if (input.pricesIncludeVat) {
    totalCents = gross;
    baseCents = roundCents(gross / (1 + vat / 100));
    vatCents = totalCents - baseCents;
  } else {
    baseCents = gross;
    vatCents = roundCents((gross * vat) / 100);
    totalCents = baseCents + vatCents;
  }
  const irpfCents = roundCents((baseCents * irpf) / 100);
  return {
    subtotalCents,
    discountCents: input.discountCents,
    shippingCents: input.shippingCents,
    baseCents,
    vatCents,
    totalCents,
    irpfCents,
    amountDueCents: totalCents - irpfCents,
  };
}

/** Importe de una línea sin IVA, para mostrarlo en el documento. */
export function netLineCents(lineCents: number, vatRatePct: number, pricesIncludeVat: boolean): number {
  return pricesIncludeVat ? roundCents(lineCents / (1 + vatRatePct / 100)) : lineCents;
}

/** «F» + 2026 + 7 → «F2026-0007» */
export function formatDocumentNumber(series: string, year: number, seq: number): string {
  return `${series}${year}-${String(seq).padStart(4, "0")}`;
}

/** Líneas de dirección listas para imprimir (sin huecos). */
export function partyAddressLines(p: Pick<DocumentParty, "addressLine" | "postalCode" | "city" | "province" | "country">): string[] {
  const cityLine = [p.postalCode, p.city].filter(Boolean).join(" ");
  const region = [cityLine, p.province && p.province !== p.city ? p.province : null].filter(Boolean).join(", ");
  return [p.addressLine, region, p.country && p.country !== "España" ? p.country : null].filter((x): x is string => Boolean(x && x.trim()));
}

/** Tipo de documento ↔ valor en la URL (`?tipo=factura`). */
export const DOCUMENT_KIND_SLUGS: Record<DocumentKind, string> = {
  invoice: "factura",
  rectifying: "rectificativa",
  quote: "presupuesto",
  delivery_note: "albaran",
};
export function kindFromSlug(slug: string | undefined): DocumentKind | null {
  const entry = Object.entries(DOCUMENT_KIND_SLUGS).find(([, s]) => s === slug);
  return entry ? (entry[0] as DocumentKind) : null;
}

/** Qué significa `dueDate` en cada tipo de documento. */
export const DOCUMENT_DUE_LABEL: Record<DocumentKind, string | null> = {
  invoice: "Vencimiento",
  rectifying: null,
  quote: "Válido hasta",
  delivery_note: null,
};

/** Campos que faltan en los datos del emisor para emitir una factura completa. */
export function missingIssuerFields(p: DocumentParty): string[] {
  const missing: string[] = [];
  if (!p.taxId) missing.push("NIF");
  if (!p.addressLine || !p.city) missing.push("domicilio fiscal");
  return missing;
}

/** Valores del formulario de documento (texto tal cual se escribe). */
export interface DocumentDraft {
  id?: string;
  kind: DocumentKind;
  /** Número ya asignado (solo al editar). */
  number?: string;
  issueDate: string;
  dueDate: string;
  orderId: string;
  /** Número del pedido de origen, para mostrarlo. */
  orderNumber?: string;
  rectifiesId: string;
  rectifiesNumber?: string;
  rectificationReason: string;
  customerId: string;
  customer: {
    name: string;
    taxId: string;
    addressLine: string;
    postalCode: string;
    city: string;
    province: string;
    country: string;
    email: string;
    phone: string;
  };
  pricesIncludeVat: boolean;
  showPrices: boolean;
  vatRatePct: string;
  irpfRatePct: string;
  discount: string;
  shipping: string;
  paymentMethod: string;
  notes: string;
  terms: string;
  items: Array<{ productId: string; description: string; quantity: string; unitPrice: string }>;
}

/* ------------------------------------------------------------------
   Presentación de la hoja (identidad de marca)
------------------------------------------------------------------- */

/** Color de marca por defecto de la hoja de documentos. */
export const DEFAULT_DOC_ACCENT = "#e30613";
const DOC_INK = "#0a0a0a";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Luminancia relativa WCAG de un color #RRGGBB. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Contraste WCAG (1–21) entre dos colores #RRGGBB. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export interface AccentTokens {
  /** Color de marca ya validado (#rrggbb en minúsculas). */
  accent: string;
  /** El acento como texto grande sobre papel blanco (número de 25 pt): pide 3:1. */
  ink: string;
  /** El acento como texto de tamaño normal (ordinales de línea y de cláusula): pide 4.5:1. */
  inkSmall: string;
  /** Texto sobre un fondo de acento (tecla del total, rectángulo del logotipo). */
  fg: string;
}

/**
 * Colores de la hoja a partir del color de marca de la sub-empresa. Valida el
 * formato (lo que no sea #RRGGBB cae al color por defecto: el valor acaba en un
 * `style`) y cuida el contraste: un acento claro no se usa como texto sobre
 * blanco (< 3:1 en el número, que es texto grande; < 4.5:1 en los ordinales) ni
 * lleva texto blanco encima (< 4.5:1). Lo que no llega va en negro.
 */
export function accentTokens(hex: string | null | undefined): AccentTokens {
  const accent = hex && HEX_COLOR.test(hex) ? hex.toLowerCase() : DEFAULT_DOC_ACCENT;
  const onWhite = contrastRatio(accent, "#ffffff");
  return {
    accent,
    ink: onWhite >= 3 ? accent : DOC_INK,
    inkSmall: onWhite >= 4.5 ? accent : DOC_INK,
    fg: onWhite >= 4.5 ? "#ffffff" : DOC_INK,
  };
}

/**
 * Tamaño del titular de la hoja según el texto: `xl` (74 pt) hasta 8 letras,
 * `lg` (52 pt) hasta 12 y `md` (40 pt) si es más largo o tiene varias palabras,
 * que van una por línea.
 */
export function titleSize(label: string): { size: "xl" | "lg" | "md"; lines: string[] } {
  const text = label.trim();
  const lines = text.split(/\s+/).filter(Boolean);
  if (lines.length > 1) return { size: "md", lines };
  const letters = Array.from(text).length;
  return { size: letters <= 8 ? "xl" : letters <= 12 ? "lg" : "md", lines: [text] };
}

/**
 * Cuerpo del importe en la tecla del total según lo largo que sea ya formateado:
 * hasta «999.999,99 €» (12 caracteres) cabe a 30 pt; después baja a 24 y a 19 pt.
 */
export function totalSize(amount: string): "normal" | "largo" | "xlargo" {
  const chars = Array.from(amount).length;
  return chars <= 12 ? "normal" : chars <= 14 ? "largo" : "xlargo";
}

/** Signo menos tipográfico («−», U+2212) en lugar del guion de `Intl` para los negativos. */
export function typographicMinus(text: string): string {
  return text.replace(/^-/, "\u2212");
}
