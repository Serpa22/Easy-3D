"use client";

import { useMemo, useState } from "react";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/display";
import { Field, MoneyInput, NumberInput, Select } from "@/components/ui/form";
import { computeUnitCost, suggestedPriceCents } from "@/lib/costing";
import { averageKwhPrice } from "@/lib/energy";
import { centsToInput, formatMoney, numberToInput } from "@/lib/format";
import type { CompanyCostParams } from "@/lib/product-cost";
import { parseDecimal, parseMoneyToCents } from "@/lib/validation";
import { CostPanel } from "./cost-panel";
import type { ProductFormMachine, ProductFormMaterial } from "./product-form";

const n = (text: string) => Math.max(0, parseDecimal(text) ?? 0);

/** Calculadora de costes independiente: no necesita dar de alta un producto. */
export function CostCalculator({ slug, materials, machines, company, vatRatePct, targetMarginPct }: { slug: string; materials: ProductFormMaterial[]; machines: ProductFormMachine[]; company: CompanyCostParams; vatRatePct: number; targetMarginPct: number }) {
  const [materialId, setMaterialId] = useState(materials[0]?.id ?? "");
  const [pricePerKg, setPricePerKg] = useState("20,00");
  const [qty, setQty] = useState("60");
  const [hours, setHours] = useState("3");
  const [minutes, setMinutes] = useState("0");
  const [pieces, setPieces] = useState("1");
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const [watts, setWatts] = useState("120");
  const [machinePrice, setMachinePrice] = useState("");
  const [lifespan, setLifespan] = useState("5000");
  const [labor, setLabor] = useState("10");
  const [laborRate, setLaborRate] = useState(centsToInput(company.laborRateCents));
  const [packaging, setPackaging] = useState("");
  const [other, setOther] = useState("");
  const [failure, setFailure] = useState(numberToInput(company.failureRatePct));
  const [margin, setMargin] = useState(numberToInput(targetMarginPct));
  const [vat, setVat] = useState(numberToInput(vatRatePct));
  const [price, setPrice] = useState("");

  const material = materials.find((m) => m.id === materialId);
  const machine = machines.find((m) => m.id === machineId);
  const batch = Math.max(1, Math.round(n(pieces)));
  const totalMinutes = n(hours) * 60 + n(minutes);

  const cost = useMemo(
    () =>
      computeUnitCost({
        materialQty: n(qty) / batch,
        materialPackCostCents: material ? material.packCostCents : (parseMoneyToCents(pricePerKg) ?? 0),
        materialPackSize: material ? material.packSize : 1000,
        printMinutes: totalMinutes / batch,
        machinePowerW: machine ? machine.powerPrintW : n(watts),
        kwhPrice: averageKwhPrice(company),
        machinePurchasePriceCents: machine ? machine.purchasePriceCents : parseMoneyToCents(machinePrice),
        machineLifespanHours: machine ? machine.lifespanHours : n(lifespan),
        laborMinutes: n(labor) / batch,
        laborRateCents: parseMoneyToCents(laborRate) ?? 0,
        packagingCostCents: parseMoneyToCents(packaging) ?? 0,
        otherCostCents: parseMoneyToCents(other) ?? 0,
        failureRatePct: n(failure),
      }),
    [qty, batch, material, pricePerKg, totalMinutes, machine, watts, company, machinePrice, lifespan, labor, laborRate, packaging, other, failure],
  );
  const suggested = suggestedPriceCents(cost.totalCents, n(margin), n(vat));
  const priceCents = parseMoneyToCents(price) ?? suggested;
  const query = new URLSearchParams({
    precio: centsToInput(priceCents),
    material: materialId,
    cantidad: numberToInput(n(qty) / batch),
    minutos: numberToInput(totalMinutes / batch, 1),
    manoobra: numberToInput(n(labor) / batch, 1),
    embalaje: packaging,
    otros: other,
    maquina: machineId,
  });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card>
          <CardHeader title="Tanda de impresión" description="Introduce los datos de la bandeja completa; el coste se reparte entre las piezas." />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Field label="Material" className="sm:col-span-2">
              <Select value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
                <option value="">Otro (precio manual)</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            {material ? (
              <Field label="Precio del material">
                <p className="flex h-10 items-center font-mono text-sm text-fg-2 tabular">{formatMoney(Math.round((material.packCostCents / (material.packSize || 1)) * 1000))}/{material.unit === "ml" ? "L" : material.unit === "g" ? "kg" : "1000 ud"}</p>
              </Field>
            ) : (
              <Field label="Precio por kg o litro">
                <MoneyInput value={pricePerKg} onChange={(e) => setPricePerKg(e.target.value)} />
              </Field>
            )}
            <Field label="Material usado en la tanda">
              <NumberInput unit={material?.unit ?? "g"} value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="Tiempo de impresión">
              <div className="grid grid-cols-2 gap-2">
                <NumberInput unit="h" value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Horas de impresión" />
                <NumberInput unit="min" value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Minutos de impresión" />
              </div>
            </Field>
            <Field label="Piezas por tanda">
              <NumberInput unit="ud" value={pieces} onChange={(e) => setPieces(e.target.value)} />
            </Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Máquina y mano de obra" />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Field label="Máquina" className="sm:col-span-3">
              <Select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
                <option value="">Otra (datos manuales)</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            {!machine ? (
              <>
                <Field label="Potencia imprimiendo">
                  <NumberInput unit="W" value={watts} onChange={(e) => setWatts(e.target.value)} />
                </Field>
                <Field label="Precio de la máquina">
                  <MoneyInput value={machinePrice} onChange={(e) => setMachinePrice(e.target.value)} />
                </Field>
                <Field label="Vida útil">
                  <NumberInput unit="h" value={lifespan} onChange={(e) => setLifespan(e.target.value)} />
                </Field>
              </>
            ) : null}
            <Field label="Mano de obra (tanda)">
              <NumberInput unit="min" value={labor} onChange={(e) => setLabor(e.target.value)} />
            </Field>
            <Field label="Coste por hora">
              <MoneyInput value={laborRate} onChange={(e) => setLaborRate(e.target.value)} />
            </Field>
            <Field label="Tasa de fallos">
              <NumberInput unit="%" value={failure} onChange={(e) => setFailure(e.target.value)} />
            </Field>
            <Field label="Embalaje por pieza">
              <MoneyInput value={packaging} onChange={(e) => setPackaging(e.target.value)} />
            </Field>
            <Field label="Otros costes por pieza">
              <MoneyInput value={other} onChange={(e) => setOther(e.target.value)} />
            </Field>
          </CardBody>
        </Card>
      </div>

      <Card className="self-start lg:sticky lg:top-6">
        <CardHeader title="Resultado por pieza" description={batch > 1 ? `Tanda de ${batch} piezas: ${formatMoney(cost.totalCents * batch)}` : undefined} />
        <CardBody className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Margen objetivo">
              <NumberInput unit="%" value={margin} onChange={(e) => setMargin(e.target.value)} />
            </Field>
            <Field label="IVA">
              <NumberInput unit="%" value={vat} onChange={(e) => setVat(e.target.value)} />
            </Field>
          </div>
          <Field label="Precio de venta a comparar" hint={`Vacío = precio recomendado (${formatMoney(suggested)})`}>
            <MoneyInput value={price} onChange={(e) => setPrice(e.target.value)} placeholder={centsToInput(suggested)} />
          </Field>
          <CostPanel cost={cost} priceCents={priceCents} vatRatePct={n(vat)} targetMarginPct={n(margin)} />
          <p className="rounded-md border border-line p-3 text-sm text-fg-2">
            Precio recomendado: <span className="font-mono text-lg font-medium text-fg tabular">{formatMoney(suggested)}</span>
            <span className="block text-[0.8125rem] text-fg-3">IVA incluido, para un margen del {numberToInput(n(margin), 0)} % sobre el precio neto.</span>
          </p>
          <Button href={`/e/${slug}/productos/nuevo?${query.toString()}`} variant="primary" icon={<PackagePlus />} block>
            Guardar como producto
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
