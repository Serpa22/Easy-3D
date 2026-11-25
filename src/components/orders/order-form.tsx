"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/display";
import { Checkbox, DateInput, Field, Input, MoneyInput, NumberInput, Select, Textarea, useAction } from "@/components/ui/form";
import { netOfVat } from "@/lib/costing";
import { ORDER_STATUSES, ORDER_STATUS_LABELS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, SALES_CHANNELS, SALES_CHANNEL_LABELS } from "@/lib/domain";
import { centsToInput, formatMoney } from "@/lib/format";
import { parseDecimal, parseMoneyToCents } from "@/lib/validation";
import { saveOrderAction } from "@/server/actions/orders";

export interface OrderFormProduct {
  id: string;
  name: string;
  priceCents: number;
}
export interface OrderFormCustomer {
  id: string;
  name: string;
  email: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
}
interface Line {
  key: number;
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
}
export interface OrderFormValues {
  id?: string;
  customerId: string;
  customerName: string;
  channel: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  orderDate: string;
  dueDate: string;
  paidAt: string;
  discount: string;
  shippingCharged: string;
  fees: string;
  shipName: string;
  shipAddressLine: string;
  shipPostalCode: string;
  shipCity: string;
  shipProvince: string;
  shipCountry: string;
  notes: string;
  items: Array<Omit<Line, "key">>;
}

const emptyLine = (key: number): Line => ({ key, productId: "", description: "", quantity: "1", unitPrice: "" });

/** Formulario completo de pedido: cliente, líneas, importes, estado, cobro y envío. */
export function OrderForm({ slug, products, customers, vatRatePct, initial }: { slug: string; products: OrderFormProduct[]; customers: OrderFormCustomer[]; vatRatePct: number; initial: OrderFormValues }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [lines, setLines] = useState<Line[]>(() => (initial.items.length ? initial.items.map((item, i) => ({ ...item, key: i })) : [emptyLine(0)]));
  const [nextKey, setNextKey] = useState(initial.items.length + 1);
  const [saveCustomer, setSaveCustomer] = useState(false);
  const [customerEmail, setCustomerEmail] = useState("");
  const { run, pending, result } = useAction(saveOrderAction, {
    onSuccess: (res) => router.push(`/e/${slug}/pedidos/${res.data?.id ?? ""}`),
    errorToast: false,
  });
  const errors = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  const set = <K extends keyof OrderFormValues>(key: K, value: OrderFormValues[K]) => setV((prev) => ({ ...prev, [key]: value }));

  const totals = useMemo(() => {
    const subtotal = lines.reduce((acc, l) => acc + Math.max(0, Math.round(parseDecimal(l.quantity) ?? 0)) * (parseMoneyToCents(l.unitPrice) ?? 0), 0);
    const discount = parseMoneyToCents(v.discount) ?? 0;
    const shipping = parseMoneyToCents(v.shippingCharged) ?? 0;
    const total = Math.max(0, subtotal - discount + shipping);
    return { subtotal, discount, shipping, total, vat: total - netOfVat(total, vatRatePct) };
  }, [lines, v.discount, v.shippingCharged, vatRatePct]);

  function pickCustomer(id: string) {
    const c = customers.find((x) => x.id === id);
    if (!c) return setV((prev) => ({ ...prev, customerId: "" }));
    setV((prev) => ({
      ...prev,
      customerId: c.id,
      customerName: c.name,
      shipName: c.name,
      shipAddressLine: c.addressLine ?? "",
      shipPostalCode: c.postalCode ?? "",
      shipCity: c.city ?? "",
      shipProvince: c.province ?? "",
      shipCountry: c.country ?? "",
    }));
  }
  function updateLine(key: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function pickProduct(key: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    updateLine(key, p ? { productId, description: p.name, unitPrice: centsToInput(p.priceCents) } : { productId: "" });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void run(slug, {
      ...v,
      saveCustomer: !v.customerId && saveCustomer,
      customerEmail,
      items: lines.filter((l) => l.description.trim() !== "" || l.unitPrice.trim() !== "").map(({ productId, description, quantity, unitPrice }) => ({ productId, description, quantity, unitPrice })),
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        {result && !result.ok && result.error ? (
          <p role="alert" className="rounded-md border border-danger bg-danger-dim px-3 py-2.5 text-sm">
            {result.error}
          </p>
        ) : null}

        <Card>
          <CardHeader title="Cliente" />
          <CardBody className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cliente guardado">
                <Select value={v.customerId} onChange={(e) => pickCustomer(e.target.value)}>
                  <option value="">Cliente nuevo o sin ficha</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Nombre" required error={errors.customerName}>
                <Input value={v.customerName} onChange={(e) => set("customerName", e.target.value)} required maxLength={120} />
              </Field>
            </div>
            {!v.customerId ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Checkbox label="Guardar como cliente nuevo" checked={saveCustomer} onChange={(e) => setSaveCustomer(e.target.checked)} />
                {saveCustomer ? (
                  <Field label="Correo electrónico">
                    <Input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} maxLength={160} />
                  </Field>
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Líneas del pedido" description="Elige un producto del catálogo o escribe una línea libre." />
          <CardBody className="flex flex-col gap-3">
            {errors.items ? <p className="text-sm text-danger">{errors.items}</p> : null}
            {lines.map((line, index) => {
              const lineTotal = Math.max(0, Math.round(parseDecimal(line.quantity) ?? 0)) * (parseMoneyToCents(line.unitPrice) ?? 0);
              return (
                <div key={line.key} className="grid grid-cols-12 items-end gap-x-3 gap-y-2 border-b border-line pb-3 last:border-b-0 last:pb-0">
                  <Field label={index === 0 ? "Producto" : <span className="sm:sr-only">Producto</span>} className="col-span-12 sm:col-span-4">
                    <Select value={line.productId} onChange={(e) => pickProduct(line.key, e.target.value)} aria-label={`Producto de la línea ${index + 1}`}>
                      <option value="">Línea libre</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={index === 0 ? "Descripción" : <span className="sm:sr-only">Descripción</span>} className="col-span-12 sm:col-span-3" error={errors[`items.${index}.description`]}>
                    <Input value={line.description} onChange={(e) => updateLine(line.key, { description: e.target.value })} maxLength={200} aria-label={`Descripción de la línea ${index + 1}`} />
                  </Field>
                  <Field label={index === 0 ? "Cant." : <span className="sm:sr-only">Cantidad</span>} className="col-span-3 sm:col-span-1" error={errors[`items.${index}.quantity`]}>
                    <NumberInput value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} aria-label={`Cantidad de la línea ${index + 1}`} />
                  </Field>
                  <Field label={index === 0 ? "Precio" : <span className="sm:sr-only">Precio</span>} className="col-span-5 sm:col-span-2" error={errors[`items.${index}.unitPrice`]}>
                    <MoneyInput value={line.unitPrice} onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })} aria-label={`Precio de la línea ${index + 1}`} />
                  </Field>
                  <div className="col-span-4 flex h-10 items-center justify-end gap-1 sm:col-span-2 pointer-coarse:h-11">
                    <span className="font-mono text-sm tabular">{formatMoney(lineTotal)}</span>
                    <button
                      type="button"
                      aria-label={`Quitar línea ${index + 1}`}
                      disabled={lines.length === 1}
                      onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                      className="flex size-9 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg active:bg-active disabled:opacity-30 pointer-coarse:size-11"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
            <div>
              <Button
                size="sm"
                icon={<Plus />}
                onClick={() => {
                  setLines((prev) => [...prev, emptyLine(nextKey)]);
                  setNextKey((k) => k + 1);
                }}
              >
                Añadir línea
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Dirección de envío" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Destinatario">
              <Input value={v.shipName} onChange={(e) => set("shipName", e.target.value)} maxLength={120} />
            </Field>
            <Field label="Dirección">
              <Input value={v.shipAddressLine} onChange={(e) => set("shipAddressLine", e.target.value)} maxLength={200} />
            </Field>
            <Field label="Código postal">
              <Input value={v.shipPostalCode} onChange={(e) => set("shipPostalCode", e.target.value)} maxLength={20} />
            </Field>
            <Field label="Ciudad">
              <Input value={v.shipCity} onChange={(e) => set("shipCity", e.target.value)} maxLength={80} />
            </Field>
            <Field label="Provincia">
              <Input value={v.shipProvince} onChange={(e) => set("shipProvince", e.target.value)} maxLength={80} />
            </Field>
            <Field label="País">
              <Input value={v.shipCountry} onChange={(e) => set("shipCountry", e.target.value)} maxLength={80} />
            </Field>
            <Field label="Notas" className="sm:col-span-2">
              <Textarea value={v.notes} onChange={(e) => set("notes", e.target.value)} rows={2} maxLength={2000} />
            </Field>
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Pedido" />
          <CardBody className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Fecha" required error={errors.orderDate}>
                <DateInput value={v.orderDate} onChange={(e) => set("orderDate", e.target.value)} required />
              </Field>
              <Field label="Fecha límite" error={errors.dueDate}>
                <DateInput value={v.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
              </Field>
            </div>
            <Field label="Canal de venta">
              <Select value={v.channel} onChange={(e) => set("channel", e.target.value)}>
                {SALES_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {SALES_CHANNEL_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Estado">
              <Select value={v.status} onChange={(e) => set("status", e.target.value)}>
                {ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ORDER_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Importes y cobro" />
          <CardBody className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Descuento" error={errors.discount}>
                <MoneyInput value={v.discount} onChange={(e) => set("discount", e.target.value)} />
              </Field>
              <Field label="Envío cobrado" error={errors.shippingCharged}>
                <MoneyInput value={v.shippingCharged} onChange={(e) => set("shippingCharged", e.target.value)} />
              </Field>
            </div>
            <Field label="Comisiones de plataforma" hint="Etsy, PayPal, pasarela… Se apuntan como gasto al cobrar." error={errors.fees}>
              <MoneyInput value={v.fees} onChange={(e) => set("fees", e.target.value)} />
            </Field>
            <dl className="flex flex-col gap-1.5 border-t border-line pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-fg-2">Subtotal</dt>
                <dd className="font-mono tabular">{formatMoney(totals.subtotal)}</dd>
              </div>
              {totals.discount > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-fg-2">Descuento</dt>
                  <dd className="font-mono tabular">−{formatMoney(totals.discount)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-fg-2">Envío</dt>
                <dd className="font-mono tabular">{formatMoney(totals.shipping)}</dd>
              </div>
              <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2.5">
                <dt className="font-semibold">Total</dt>
                <dd className="font-mono text-xl font-medium tabular">{formatMoney(totals.total)}</dd>
              </div>
              <p className="text-right text-[0.8125rem] text-fg-3">IVA incluido ({vatRatePct} %): {formatMoney(totals.vat)}</p>
            </dl>
            <Field label="Cobro">
              <Select value={v.paymentStatus} onChange={(e) => set("paymentStatus", e.target.value)}>
                <option value="unpaid">Sin cobrar</option>
                <option value="paid">Cobrado</option>
                <option value="refunded">Reembolsado</option>
              </Select>
            </Field>
            {v.paymentStatus === "paid" ? (
              <div className="grid grid-cols-2 gap-4">
                <Field label="Fecha de cobro">
                  <DateInput value={v.paidAt} onChange={(e) => set("paidAt", e.target.value)} />
                </Field>
                <Field label="Método">
                  <Select value={v.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>
                    <option value="">Sin indicar</option>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <div className="flex flex-col-reverse gap-2 sm:flex-row lg:flex-col-reverse">
          <Button href={v.id ? `/e/${slug}/pedidos/${v.id}` : `/e/${slug}/pedidos`} block>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" size="lg" loading={pending} block>
            {v.id ? "Guardar cambios" : "Crear pedido"}
          </Button>
        </div>
      </div>
    </form>
  );
}
