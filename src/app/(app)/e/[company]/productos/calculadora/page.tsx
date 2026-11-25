import type { Metadata } from "next";
import { CostCalculator } from "@/components/products/calculator";
import { companyCostParams, productFormOptions } from "@/components/products/form-data";
import { PageHeader } from "@/components/ui/display";
import { requireCompany } from "@/server/context";

export const metadata: Metadata = { title: "Calculadora de costes" };

export default async function CalculatorPage({ params }: { params: Promise<{ company: string }> }) {
  const { company, db } = await requireCompany((await params).company);
  const options = await productFormOptions(db, company.id);
  return (
    <>
      <PageHeader back={{ href: `/e/${company.slug}/productos`, label: "Productos" }} title="Calculadora de costes" description="¿Cuánto te cuesta una pieza y a qué precio venderla? Calcula sin necesidad de dar de alta el producto." />
      <CostCalculator slug={company.slug} materials={options.materials} machines={options.machines} company={companyCostParams(company)} vatRatePct={company.vatRatePct} targetMarginPct={company.targetMarginPct} />
    </>
  );
}
