"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/display";
import { ActionForm, Checkbox, Field, FormActions, Input, MoneyInput, NumberInput, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { suggestedPriceCents } from "@/lib/costing";
import { centsToInput, formatMoney, numberToInput } from "@/lib/format";
import { productUnitCost, type CompanyCostParams } from "@/lib/product-cost";
import { parseDecimal, parseMoneyToCents } from "@/lib/validation";
import { saveProductAction } from "@/server/actions/products";
import { CostPanel } from "./cost-panel";

export interface ProductFormMaterial {
  id: string;
  name: string;
  unit: string;
  packSize: number;
  packCostCents: number;
}
export interface ProductFormMachine {
  id: string;
  name: string;
  powerPrintW: number;
  purchasePriceCents: number | null;
  lifespanHours: number;
}
export interface ProductFormValues {
  id?: string;
  name: string;
  sku: string;
  category: string;
  description: string;
  price: string;
  materialId: string;
  materialQty: string;
  printMinutes: string;
  laborMinutes: string;
  packagingCost: string;
  otherCost: string;
  machineId: string;
  stockQty: string;
  lowStockThreshold: string;
  active: boolean;
}

export const EMPTY_PRODUCT: ProductFormValues = {
  name: "", sku: "", category: "", description: "", price: "", materialId: "", materialQty: "", printMinutes: "", laborMinutes: "", packagingCost: "", otherCost: "", machineId: "", stockQty: "0", lowStockThreshold: "0", active: true,
};

/** Alta/edición de producto con el coste y el margen calculándose en vivo. */
export function ProductForm({
  slug,
  initial,
  materials,
  machines,
  categories,
  company,
  vatRatePct,
  targetMarginPct,
}: {
  slug: string;
  initial: ProductFormValues;
  materials: ProductFormMaterial[];
  machines: ProductFormMachine[];
  categories: string[];
  company: CompanyCostParams;
  vatRatePct: number;
  targetMarginPct: number;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) => setV((prev) => ({ ...prev, [key]: value }));
  const material = materials.find((m) => m.id === v.materialId);
  const machine = machines.find((m) => m.id === v.machineId);
  const cost = useMemo(
    () =>
      productUnitCost(
        {
          materialQty: parseDecimal(v.materialQty) ?? 0,
          printMinutes: parseDecimal(v.printMinutes) ?? 0,
          laborMinutes: parseDecimal(v.laborMinutes) ?? 0,
          packagingCostCents: parseMoneyToCents(v.packagingCost) ?? 0,
          otherCostCents: parseMoneyToCents(v.otherCost) ?? 0,
        },
        material,
        machine,
        company,
      ),
    [v.materialQty, v.printMinutes, v.laborMinutes, v.packagingCost, v.otherCost, material, machine, company],
  );
  const priceCents = parseMoneyToCents(v.price) ?? 0;
  const suggested = suggestedPriceCents(cost.totalCents, targetMarginPct, vatRatePct);
  const back = initial.id ? `/e/${slug}/productos/${initial.id}` : `/e/${slug}/productos`;

  return (
    <ActionForm action={saveProductAction.bind(null, slug)} onSuccess={(res) => router.push(`/e/${slug}/productos/${(res.data as { id?: string } | undefined)?.id ?? ""}`)} className="grid gap-4 lg:grid-cols-3">
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card>
          <CardHeader title="Producto" />
          <CardBody className="flex flex-col gap-4">
            <Field label="Nombre" name="name" required>
              <Input value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="Set Cherry 61 teclas · Negro" maxLength={120} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="SKU" name="sku">
                <Input value={v.sku} onChange={(e) => set("sku", e.target.value)} maxLength={60} className="font-mono" />
              </Field>
              <Field label="Categoría" name="category">
                <Input value={v.category} onChange={(e) => set("category", e.target.value)} list="product-categories" maxLength={60} />
              </Field>
              <Field label="Precio de venta (IVA incl.)" name="price" required>
                <MoneyInput value={v.price} onChange={(e) => set("price", e.target.value)} />
              </Field>
            </div>
            <Field label="Descripción" name="description">
              <Textarea value={v.description} onChange={(e) => set("description", e.target.value)} rows={2} maxLength={2000} />
            </Field>
            <datalist id="product-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Receta de fabricación" description="Lo que cuesta producir una unidad. Si imprimes varias por tanda, divide el tiempo y el material entre las piezas." />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Material" name="materialId">
              <Select value={v.materialId} onChange={(e) => set("materialId", e.target.value)}>
                <option value="">Sin material</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Material por unidad" name="materialQty">
              <NumberInput unit={material?.unit ?? "g"} value={v.materialQty} onChange={(e) => set("materialQty", e.target.value)} />
            </Field>
            <Field label="Máquina habitual" name="machineId" hint="Aporta el consumo eléctrico y la amortización.">
              <Select value={v.machineId} onChange={(e) => set("machineId", e.target.value)}>
                <option value="">Sin máquina</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tiempo de impresión por unidad" name="printMinutes">
              <NumberInput unit="min" value={v.printMinutes} onChange={(e) => set("printMinutes", e.target.value)} />
            </Field>
            <Field label="Mano de obra por unidad" name="laborMinutes" hint={`A ${formatMoney(company.laborRateCents)}/hora (Ajustes).`}>
              <NumberInput unit="min" value={v.laborMinutes} onChange={(e) => set("laborMinutes", e.target.value)} />
            </Field>
            <Field label="Embalaje" name="packagingCost">
              <MoneyInput value={v.packagingCost} onChange={(e) => set("packagingCost", e.target.value)} />
            </Field>
            <Field label="Otros costes" name="otherCost">
              <MoneyInput value={v.otherCost} onChange={(e) => set("otherCost", e.target.value)} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Stock de producto terminado" />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Field label="Unidades en stock" name="stockQty">
              <NumberInput unit="ud" value={v.stockQty} onChange={(e) => set("stockQty", e.target.value)} />
            </Field>
            <Field label="Aviso de stock bajo" name="lowStockThreshold">
              <NumberInput unit="ud" value={v.lowStockThreshold} onChange={(e) => set("lowStockThreshold", e.target.value)} />
            </Field>
            <Checkbox name="active" checked={v.active} onChange={(e) => set("active", e.target.checked)} label="Producto activo" hint="Los inactivos no se ofrecen al crear pedidos." className="sm:mt-6" />
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card className="lg:sticky lg:top-6">
          <CardHeader title="Coste y margen" description="Se calcula mientras escribes." />
          <CardBody className="flex flex-col gap-4">
            <CostPanel cost={cost} priceCents={priceCents} vatRatePct={vatRatePct} targetMarginPct={targetMarginPct} />
            <div className="rounded-md border border-line p-3 text-sm">
              <p className="text-fg-2">
                Precio recomendado para un margen del {numberToInput(targetMarginPct, 0)} %: <span className="font-mono font-medium text-fg tabular">{formatMoney(suggested)}</span>
              </p>
              <Button size="sm" icon={<Wand2 />} className="mt-2.5" onClick={() => set("price", centsToInput(suggested))} disabled={cost.totalCents === 0}>
                Aplicar precio
              </Button>
            </div>
            <FormActions className="mt-0 sm:flex-col-reverse">
              <Button href={back} block>
                Cancelar
              </Button>
              <SubmitButton size="lg" block>
                {initial.id ? "Guardar cambios" : "Crear producto"}
              </SubmitButton>
            </FormActions>
          </CardBody>
        </Card>
      </div>
    </ActionForm>
  );
}
