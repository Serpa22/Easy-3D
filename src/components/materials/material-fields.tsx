import { ColorInput, DateInput, Field, Input, MoneyInput, NumberInput, Select, Textarea } from "@/components/ui/form";
import { MATERIAL_KINDS, MATERIAL_KIND_LABELS, MATERIAL_UNITS, MATERIAL_UNIT_LABELS } from "@/lib/domain";
import { centsToInput, formatQty, numberToInput } from "@/lib/format";
import type { Material } from "@/server/db/schema";

const TYPES = ["PLA", "PLA+", "PETG", "ABS", "ASA", "TPU", "PA", "PC", "Resina estándar", "Resina ABS-like", "Resina lavable"];

/** Muestra de color con borde visible en ambos temas. */
export function Swatch({ color, className = "size-4" }: { color: string | null; className?: string }) {
  return <span aria-hidden="true" className={`inline-block shrink-0 rounded-xl border border-control ${className}`} style={{ background: color ?? "transparent" }} />;
}

export function MaterialFields({ material }: { material?: Material }) {
  return (
    <>
      {material ? <input type="hidden" name="id" value={material.id} /> : null}
      <Field label="Nombre" name="name" required>
        <Input defaultValue={material?.name} placeholder="PLA Negro mate" maxLength={120} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Clase" name="kind">
          <Select defaultValue={material?.kind ?? "filament"}>
            {MATERIAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {MATERIAL_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tipo de material" name="materialType">
          <Input defaultValue={material?.materialType ?? ""} list="material-types" placeholder="PLA" maxLength={60} />
        </Field>
        <Field label="Marca" name="brand">
          <Input defaultValue={material?.brand ?? ""} maxLength={60} />
        </Field>
        <Field label="Nombre del color" name="colorName">
          <Input defaultValue={material?.colorName ?? ""} placeholder="Negro" maxLength={60} />
        </Field>
        <Field label="Color" name="colorHex">
          <ColorInput defaultValue={material?.colorHex ?? "#808080"} />
        </Field>
        <Field label="Unidad" name="unit" hint={material ? "No se puede cambiar si ya tiene movimientos." : "Gramos para filamento, mililitros para resina."}>
          <Select defaultValue={material?.unit ?? "g"}>
            {MATERIAL_UNITS.map((u) => (
              <option key={u} value={u}>
                {MATERIAL_UNIT_LABELS[u]} ({u})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tamaño del envase" name="packSize" required hint="Bobina de 1000 g, botella de 1000 ml…">
          <NumberInput defaultValue={numberToInput(material?.packSize ?? 1000)} />
        </Field>
        <Field label="Precio del envase" name="packCost">
          <MoneyInput defaultValue={centsToInput(material?.packCostCents || null)} />
        </Field>
        {!material ? (
          <Field label="Stock inicial" name="initialStock" hint="En la unidad elegida.">
            <NumberInput defaultValue="" />
          </Field>
        ) : null}
        <Field label="Aviso de stock bajo" name="lowStockThreshold" hint="Avisa cuando baje de esta cantidad.">
          <NumberInput defaultValue={numberToInput(material?.lowStockThreshold ?? 0)} />
        </Field>
        <Field label="Proveedor" name="supplier">
          <Input defaultValue={material?.supplier ?? ""} maxLength={120} />
        </Field>
        <Field label="Ubicación" name="location">
          <Input defaultValue={material?.location ?? ""} placeholder="Armario seco · balda 2" maxLength={120} />
        </Field>
      </div>
      <Field label="Notas" name="notes">
        <Textarea defaultValue={material?.notes ?? ""} rows={2} maxLength={2000} />
      </Field>
      <datalist id="material-types">
        {TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </>
  );
}

export function PurchaseFields({ material, today, vat }: { material: Material; today: string; vat: number }) {
  return (
    <>
      <input type="hidden" name="materialId" value={material.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Envases comprados" name="packs" required hint={`Cada envase: ${formatQty(material.packSize, material.unit)}`}>
          <NumberInput defaultValue="1" unit="ud" />
        </Field>
        <Field label="Coste total (IVA incluido)" name="totalCost" required>
          <MoneyInput defaultValue={centsToInput(material.packCostCents || null)} />
        </Field>
        <Field label="Fecha" name="date" required>
          <DateInput defaultValue={today} />
        </Field>
        <Field label="IVA" name="vatRatePct">
          <NumberInput unit="%" defaultValue={numberToInput(vat)} />
        </Field>
      </div>
      <Field label="Proveedor" name="supplier">
        <Input defaultValue={material.supplier ?? ""} maxLength={120} />
      </Field>
      <p className="text-[0.8125rem] text-fg-3">La compra suma stock y se apunta como gasto en Finanzas.</p>
    </>
  );
}

export function AdjustFields({ material }: { material: Material }) {
  return (
    <>
      <input type="hidden" name="materialId" value={material.id} />
      <Field label="Stock real contado" name="realStock" required hint={`Ahora consta: ${formatQty(material.stockQty, material.unit)}`}>
        <NumberInput unit={material.unit} defaultValue={numberToInput(material.stockQty)} />
      </Field>
      <Field label="Motivo" name="note">
        <Input placeholder="Recuento de inventario" maxLength={300} />
      </Field>
    </>
  );
}

export function WasteFields({ material }: { material: Material }) {
  return (
    <>
      <input type="hidden" name="materialId" value={material.id} />
      <Field label="Cantidad perdida" name="qty" required>
        <NumberInput unit={material.unit} />
      </Field>
      <Field label="Motivo" name="note">
        <Input placeholder="Bobina con humedad, purga, prueba fallida…" maxLength={300} />
      </Field>
    </>
  );
}
