import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { companyCostParams, productFormOptions } from "@/components/products/form-data";
import { ProductForm } from "@/components/products/product-form";
import { PageHeader } from "@/components/ui/display";
import { centsToInput, numberToInput } from "@/lib/format";
import { requireCompany } from "@/server/context";
import { products } from "@/server/db/schema";
import { listProducts } from "@/server/queries/products";

export const metadata: Metadata = { title: "Editar producto" };

export default async function EditProductPage({ params }: { params: Promise<{ company: string; id: string }> }) {
  const { company: slugParam, id } = await params;
  const { company, db } = await requireCompany(slugParam);
  if (!z.uuid().safeParse(id).success) notFound();
  const [[p], options, list] = await Promise.all([
    db.select().from(products).where(and(eq(products.id, id), eq(products.companyId, company.id))).limit(1),
    productFormOptions(db, company.id),
    listProducts(db, company.id, { since30: "2999-01-01" }),
  ]);
  if (!p) notFound();
  return (
    <>
      <PageHeader back={{ href: `/e/${company.slug}/productos/${p.id}`, label: p.name }} title="Editar producto" />
      <ProductForm
        slug={company.slug}
        initial={{
          id: p.id,
          name: p.name,
          sku: p.sku ?? "",
          category: p.category ?? "",
          description: p.description ?? "",
          price: centsToInput(p.priceCents),
          materialId: p.materialId ?? "",
          materialQty: numberToInput(p.materialQty),
          printMinutes: numberToInput(p.printMinutes),
          laborMinutes: numberToInput(p.laborMinutes),
          packagingCost: centsToInput(p.packagingCostCents || null),
          otherCost: centsToInput(p.otherCostCents || null),
          machineId: p.machineId ?? "",
          stockQty: String(p.stockQty),
          lowStockThreshold: String(p.lowStockThreshold),
          active: p.active,
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
