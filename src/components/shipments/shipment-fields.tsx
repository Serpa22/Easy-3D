import { DateInput, Field, Input, MoneyInput, NumberInput, Select, Textarea } from "@/components/ui/form";
import { CARRIERS } from "@/lib/carriers";
import { SHIPMENT_STATUSES, SHIPMENT_STATUS_LABELS } from "@/lib/domain";
import { centsToInput } from "@/lib/format";
import type { Shipment } from "@/server/db/schema";

export interface ShipmentOrderOption {
  id: string;
  number: string;
  customerName: string;
}

/** Campos del formulario de envío. `defaults` rellena un alta desde un pedido. */
export function ShipmentFields({
  shipment,
  orders,
  defaults,
}: {
  shipment?: Shipment;
  orders: ShipmentOrderOption[];
  defaults?: { orderId?: string; recipientName?: string | null; destination?: string | null };
}) {
  const known = CARRIERS.some((c) => c.id === shipment?.carrier);
  return (
    <>
      {shipment ? <input type="hidden" name="id" value={shipment.id} /> : null}
      <Field label="Pedido" name="orderId" hint="Opcional. Al enviarlo, el pedido pasará a «Enviado».">
        <Select defaultValue={shipment?.orderId ?? defaults?.orderId ?? ""}>
          <option value="">Sin pedido asociado</option>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>
              {o.number} · {o.customerName}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Transportista" name="carrier" required>
          <Select defaultValue={shipment?.carrier ?? "correos"}>
            {CARRIERS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
            {shipment && !known ? <option value={shipment.carrier}>{shipment.carrier}</option> : null}
          </Select>
        </Field>
        <Field label="Servicio" name="service">
          <Input defaultValue={shipment?.service ?? ""} placeholder="Estándar 48 h" maxLength={80} />
        </Field>
        <Field label="Nº de seguimiento" name="trackingNumber">
          <Input defaultValue={shipment?.trackingNumber ?? ""} maxLength={80} autoComplete="off" className="font-mono" />
        </Field>
        <Field label="Estado" name="status">
          <Select defaultValue={shipment?.status ?? "pending"}>
            {SHIPMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SHIPMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Enlace de seguimiento" name="trackingUrl" hint="Si lo dejas vacío se calcula con el transportista y el número.">
        <Input type="url" defaultValue={shipment?.trackingUrl ?? ""} placeholder="https://…" maxLength={500} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Destinatario" name="recipientName">
          <Input defaultValue={shipment?.recipientName ?? defaults?.recipientName ?? ""} maxLength={120} />
        </Field>
        <Field label="Destino" name="destination">
          <Input defaultValue={shipment?.destination ?? defaults?.destination ?? ""} placeholder="Valencia, España" maxLength={160} />
        </Field>
        <Field label="Coste del envío" name="cost" hint="Se apunta como gasto en Finanzas.">
          <MoneyInput defaultValue={centsToInput(shipment?.costCents || null)} />
        </Field>
        <Field label="Peso" name="weightG">
          <NumberInput unit="g" defaultValue={shipment?.weightG ?? ""} />
        </Field>
        <Field label="Fecha de envío" name="shippedAt">
          <DateInput defaultValue={shipment?.shippedAt ?? ""} />
        </Field>
        <Field label="Entrega prevista" name="estimatedDelivery">
          <DateInput defaultValue={shipment?.estimatedDelivery ?? ""} />
        </Field>
        <Field label="Fecha de entrega" name="deliveredAt">
          <DateInput defaultValue={shipment?.deliveredAt ?? ""} />
        </Field>
      </div>
      <Field label="Notas" name="notes">
        <Textarea defaultValue={shipment?.notes ?? ""} rows={2} maxLength={2000} />
      </Field>
    </>
  );
}
