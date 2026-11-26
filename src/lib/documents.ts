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
