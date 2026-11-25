import "server-only";
import type { DbOrTx } from "@/server/db";
import type { Company } from "@/server/db/schema";
import type { CompanyCostParams } from "@/lib/product-cost";
import { listMachineOptions, listMaterialOptions } from "@/server/queries/machines";

/** Parámetros de coste de la empresa que necesita el formulario (serializables). */
export function companyCostParams(company: Company): CompanyCostParams {
  return {
    electricityMode: company.electricityMode,
    kwhPrice: company.kwhPrice,
    kwhPricePeak: company.kwhPricePeak,
    kwhPriceFlat: company.kwhPriceFlat,
    kwhPriceValley: company.kwhPriceValley,
    laborRateCents: company.laborRateCents,
    failureRatePct: company.failureRatePct,
  };
}

/** Materiales y máquinas para los desplegables del formulario de producto y la calculadora. */
export async function productFormOptions(db: DbOrTx, companyId: string) {
  const [materials, machines] = await Promise.all([listMaterialOptions(db, companyId), listMachineOptions(db, companyId)]);
  return {
    materials: materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit, packSize: m.packSize, packCostCents: m.packCostCents })),
    machines: machines.map((m) => ({ id: m.id, name: m.name, powerPrintW: m.powerPrintW, purchasePriceCents: m.purchasePriceCents, lifespanHours: m.lifespanHours })),
  };
}
