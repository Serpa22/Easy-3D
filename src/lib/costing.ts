/**
 * Cálculo del coste de fabricar una pieza y del precio de venta recomendado.
 * Funciones puras (isomórficas): las usa la ficha de producto, la calculadora
 * y los informes de margen.
 */

export interface CostInputs {
  /** Material por unidad, en la unidad del material (g / ml / ud). */
  materialQty: number;
  /** Precio del envase de material (céntimos) y su tamaño en la misma unidad. */
  materialPackCostCents: number;
  materialPackSize: number;
  /** Minutos de impresión por unidad. */
  printMinutes: number;
  /** Potencia media de la máquina imprimiendo (W). */
  machinePowerW: number;
  /** €/kWh. */
  kwhPrice: number;
  /** Amortización: precio de compra de la máquina y horas de vida útil. */
  machinePurchasePriceCents?: number | null;
  machineLifespanHours?: number | null;
  /** Minutos de mano de obra por unidad (postprocesado, montaje, embalaje) y €/hora en céntimos. */
  laborMinutes: number;
  laborRateCents: number;
  packagingCostCents: number;
  otherCostCents: number;
  /** % de impresiones fallidas: encarece material, energía y máquina. */
  failureRatePct: number;
}

export interface CostBreakdown {
  materialCents: number;
  energyCents: number;
  depreciationCents: number;
  laborCents: number;
  packagingCents: number;
  otherCents: number;
  /** Sobrecoste por fallos. */
  failureCents: number;
  totalCents: number;
}

const safe = (n: number | null | undefined) => (Number.isFinite(n as number) ? Math.max(0, n as number) : 0);

/** Coste unitario desglosado. Devuelve céntimos enteros; el total es la suma de las partes. */
export function computeUnitCost(input: CostInputs): CostBreakdown {
  const packSize = safe(input.materialPackSize);
  const material = packSize > 0 ? (safe(input.materialQty) / packSize) * safe(input.materialPackCostCents) : 0;

  const hours = safe(input.printMinutes) / 60;
  const energy = (safe(input.machinePowerW) / 1000) * hours * safe(input.kwhPrice) * 100;

  const lifespan = safe(input.machineLifespanHours);
  const depreciation = lifespan > 0 ? (safe(input.machinePurchasePriceCents) / lifespan) * hours : 0;

  const labor = (safe(input.laborMinutes) / 60) * safe(input.laborRateCents);

  // Un fallo desperdicia material, energía y tiempo de máquina (no la mano de obra ni el embalaje).
  const rate = Math.min(safe(input.failureRatePct), 95) / 100;
  const failure = rate > 0 ? ((material + energy + depreciation) * rate) / (1 - rate) : 0;

  const parts = {
    materialCents: Math.round(material),
    energyCents: Math.round(energy),
    depreciationCents: Math.round(depreciation),
    laborCents: Math.round(labor),
    packagingCents: Math.round(safe(input.packagingCostCents)),
    otherCents: Math.round(safe(input.otherCostCents)),
    failureCents: Math.round(failure),
  };
  const totalCents = Object.values(parts).reduce((a, b) => a + b, 0);
  return { ...parts, totalCents };
}

/** Importe sin IVA a partir de un importe con IVA. */
export function netOfVat(grossCents: number, vatRatePct: number): number {
  return Math.round(grossCents / (1 + safe(vatRatePct) / 100));
}

/** Cuota de IVA contenida en un importe con IVA. */
export function vatPortion(grossCents: number, vatRatePct: number): number {
  return grossCents - netOfVat(grossCents, vatRatePct);
}

export interface Margin {
  /** Precio sin IVA. */
  netCents: number;
  /** Beneficio por unidad (neto − coste). */
  profitCents: number;
  /** Margen sobre el precio neto, en %. */
  marginPct: number;
  /** Recargo sobre el coste (markup), en %. */
  markupPct: number;
}

/** Margen de un precio de venta (IVA incluido) frente a un coste. */
export function marginOf(priceGrossCents: number, costCents: number, vatRatePct: number): Margin {
  const netCents = netOfVat(priceGrossCents, vatRatePct);
  const profitCents = netCents - costCents;
  return {
    netCents,
    profitCents,
    marginPct: netCents > 0 ? (profitCents / netCents) * 100 : 0,
    markupPct: costCents > 0 ? (profitCents / costCents) * 100 : 0,
  };
}

/**
 * Precio de venta recomendado (IVA incluido) para lograr un margen objetivo
 * sobre el precio neto. Redondea al múltiplo de `roundToCents` superior.
 */
export function suggestedPriceCents(
  costCents: number,
  targetMarginPct: number,
  vatRatePct: number,
  roundToCents = 10,
): number {
  const margin = Math.min(Math.max(targetMarginPct, 0), 95) / 100;
  const net = costCents / (1 - margin);
  const gross = net * (1 + safe(vatRatePct) / 100);
  const step = Math.max(1, roundToCents);
  return Math.ceil(gross / step - 1e-9) * step;
}
