/**
 * Coste unitario de un producto a partir de su receta, su material, su máquina
 * y los parámetros de la sub-empresa. Única fuente del cálculo: la usan la
 * lista, la ficha, el formulario en vivo y la rentabilidad de pedidos.
 */
import { computeUnitCost, type CostBreakdown, type CostInputs } from "./costing";
import { averageKwhPrice, type ElectricityTariff } from "./energy";

export interface RecipeLike {
  materialQty: number;
  printMinutes: number;
  laborMinutes: number;
  packagingCostCents: number;
  otherCostCents: number;
}
export interface MaterialCostLike {
  packCostCents: number;
  packSize: number;
}
export interface MachineCostLike {
  powerPrintW: number;
  purchasePriceCents: number | null;
  lifespanHours: number;
}
export interface CompanyCostParams extends ElectricityTariff {
  laborRateCents: number;
  failureRatePct: number;
}

export function productCostInputs(recipe: RecipeLike, material: MaterialCostLike | null | undefined, machine: MachineCostLike | null | undefined, company: CompanyCostParams): CostInputs {
  return {
    materialQty: recipe.materialQty,
    materialPackCostCents: material?.packCostCents ?? 0,
    materialPackSize: material?.packSize ?? 0,
    printMinutes: recipe.printMinutes,
    machinePowerW: machine?.powerPrintW ?? 0,
    kwhPrice: averageKwhPrice(company),
    machinePurchasePriceCents: machine?.purchasePriceCents ?? null,
    machineLifespanHours: machine?.lifespanHours ?? null,
    laborMinutes: recipe.laborMinutes,
    laborRateCents: company.laborRateCents,
    packagingCostCents: recipe.packagingCostCents,
    otherCostCents: recipe.otherCostCents,
    failureRatePct: company.failureRatePct,
  };
}

export function productUnitCost(recipe: RecipeLike, material: MaterialCostLike | null | undefined, machine: MachineCostLike | null | undefined, company: CompanyCostParams): CostBreakdown {
  return computeUnitCost(productCostInputs(recipe, material, machine, company));
}

export const COST_PARTS: Array<{ key: keyof Omit<CostBreakdown, "totalCents">; label: string }> = [
  { key: "materialCents", label: "Material" },
  { key: "energyCents", label: "Energía" },
  { key: "depreciationCents", label: "Amortización de máquina" },
  { key: "laborCents", label: "Mano de obra" },
  { key: "packagingCents", label: "Embalaje" },
  { key: "otherCents", label: "Otros" },
  { key: "failureCents", label: "Sobrecoste por fallos" },
];
