import type { Metadata } from "next";
import { companyCostParams, productFormOptions } from "@/components/products/form-data";
import { EMPTY_PRODUCT, ProductForm } from "@/components/products/product-form";
import { PageHeader } from "@/components/ui/display";
import { param, type SearchParams } from "@/components/ui/nav";
import { requireCompany } from "@/server/context";
import { listProducts } from "@/server/queries/products";

export const metadata: Metadata = { title: "Nuevo producto" };

export default async function NewProductPage({ params, searchParams }: { params: Promise<{ company: string }>; searchParams: Promise<SearchParams> }) {
  const { company, db } = await requireCompany((await params).company);
  const sp = await searchParams;
  const [options, list] = await Promise.all([productFormOptions(db, company.id), listProducts(db, company.id, { since30: "2999-01-01" })]);
  // La calculadora puede enviar valores iniciales por la URL.
  const text = (key: string) => (param(sp, key) ?? "").slice(0, 120);
  return (
    <>
      <PageHeader back={{ href: `/e/${company.slug}/productos`, label: "Productos" }} title="Nuevo producto" />
      <ProductForm
        slug={company.slug}
        initial={{
          ...EMPTY_PRODUCT,
          price: text("precio"),
          materialId: options.materials.some((m) => m.id === text("material")) ? text("material") : "",
          materialQty: text("cantidad"),
          printMinutes: text("minutos"),
          laborMinutes: text("manoobra"),
          packagingCost: text("embalaje"),
          otherCost: text("otros"),
          machineId: options.machines.some((m) => m.id === text("maquina")) ? text("maquina") : "",
        }}
        materials={options.materials}
        machines={options.machines}
        categories={list.categories}
        company={companyCostParams(company)}
        vatRatePct={company.vatRatePct}
        targetMarginPct={company.targetMarginPct}
      />
    </>
  );
}
