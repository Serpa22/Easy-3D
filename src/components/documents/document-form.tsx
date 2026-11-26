"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardBody, CardHeader } from "@/components/ui/display";
import { Checkbox, DateInput, Field, Input, MoneyInput, NumberInput, Select, Textarea, useAction } from "@/components/ui/form";
import { DOCUMENT_DUE_LABEL, computeDocumentTotals, lineTotalCents, type DocumentDraft } from "@/lib/documents";
import { DOCUMENT_KIND_LABELS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/domain";
import { centsToInput, formatDateNumeric, formatMoney } from "@/lib/format";
import { parseDecimal, parseMoneyToCents } from "@/lib/validation";
import { saveDocumentAction } from "@/server/actions/documents";

export interface DocumentFormProduct {
  id: string;
  name: string;
  priceCents: number;
}
export interface DocumentFormCustomer {
  id: string;
  name: string;
  taxId: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
}
export interface DocumentFormInvoice {
  id: string;
  number: string;
  issueDate: string;
  customerName: string;
  totalCents: number;
}

type Line = DocumentDraft["items"][number] & { key: number };
const emptyLine = (key: number): Line => ({ key, productId: "", description: "", quantity: "1", unitPrice: "" });

/** Formulario de factura, rectificativa, presupuesto o albarán. */
export function DocumentForm({
  slug,
  initial,
  products,
  customers,
  invoices,
  cancelHref,
}: {
  slug: string;
  initial: DocumentDraft;
  products: DocumentFormProduct[];
  customers: DocumentFormCustomer[];
  /** Facturas que se pueden rectificar (solo rectificativas). */
  invoices: DocumentFormInvoice[];
  cancelHref: string;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [lines, setLines] = useState<Line[]>(() => (initial.items.length ? initial.items.map((item, i) => ({ ...item, key: i })) : [emptyLine(0)]));
  const [nextKey, setNextKey] = useState(initial.items.length + 1);
  const { run, pending, result } = useAction(saveDocumentAction, {
    onSuccess: (res) => router.push(`/e/${slug}/documentos/${res.data?.id ?? ""}`),
    errorToast: false,
  });
  const errors = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  const set = <K extends keyof DocumentDraft>(key: K, value: DocumentDraft[K]) => setV((prev) => ({ ...prev, [key]: value }));
  const setCustomer = (key: keyof DocumentDraft["customer"], value: string) => setV((prev) => ({ ...prev, customer: { ...prev.customer, [key]: value } }));

  const kind = v.kind;
  const isRect = kind === "rectifying";
  const isDelivery = kind === "delivery_note";
  const fiscal = kind === "invoice" || isRect;
  const showAmounts = !isDelivery || v.showPrices;
  const dueLabel = DOCUMENT_DUE_LABEL[kind];
  const label = DOCUMENT_KIND_LABELS[kind];

  const totals = useMemo(
    () =>
      computeDocumentTotals({
        lines: lines.map((l) => ({ quantity: parseDecimal(l.quantity) ?? 0, unitPriceCents: parseMoneyToCents(l.unitPrice) ?? 0 })),
        discountCents: parseMoneyToCents(v.discount) ?? 0,
        shippingCents: parseMoneyToCents(v.shipping) ?? 0,
        vatRatePct: parseDecimal(v.vatRatePct) ?? 0,
        irpfRatePct: fiscal ? (parseDecimal(v.irpfRatePct) ?? 0) : 0,
        pricesIncludeVat: v.pricesIncludeVat,
      }),
    [lines, v.discount, v.shipping, v.vatRatePct, v.irpfRatePct, v.pricesIncludeVat, fiscal],
  );

  function pickCustomer(id: string) {
    const c = customers.find((x) => x.id === id);
    if (!c) return setV((prev) => ({ ...prev, customerId: "" }));
    setV((prev) => ({
      ...prev,
      customerId: c.id,
      customer: {
        name: c.name,
        taxId: c.taxId ?? "",
        addressLine: c.addressLine ?? "",
        postalCode: c.postalCode ?? "",
        city: c.city ?? "",
        province: c.province ?? "",
        country: c.country ?? "",
        email: c.email ?? "",
        phone: c.phone ?? "",
      },
    }));
  }
  function updateLine(key: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function pickProduct(key: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    // Los precios del catálogo llevan IVA incluido.
    if (p && !v.pricesIncludeVat) {
      const vat = parseDecimal(v.vatRatePct) ?? 0;
      return updateLine(key, { productId, description: p.name, unitPrice: centsToInput(Math.round(p.priceCents / (1 + vat / 100))) });
    }
    updateLine(key, p ? { productId, description: p.name, unitPrice: centsToInput(p.priceCents) } : { productId: "" });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void run(slug, {
      ...v,
      items: lines
        .filter((l) => l.description.trim() !== "" || l.unitPrice.trim() !== "")
        .map(({ productId, description, quantity, unitPrice }) => ({ productId, description, quantity, unitPrice: isDelivery && !v.showPrices && unitPrice.trim() === "" ? "0" : unitPrice })),
    });
  }

  return (
    <form method="post" onSubmit={submit} className="grid gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        {result && !result.ok && result.error ? (
          <p role="alert" className="rounded-md border border-danger bg-danger-dim px-3 py-2.5 text-sm">
            {result.error}
          </p>
        ) : null}
        {v.id && fiscal ? (
          <Alert tone="warn" title="Estás editando una factura ya emitida">
            Si ya se la has enviado al cliente, no la cambies: emite una factura rectificativa para que quede constancia de la corrección.
          </Alert>
        ) : null}

        {isRect ? (
          <Card>
            <CardHeader title="Factura que se rectifica" description="Las líneas en negativo anulan importes de la original; en positivo, los añaden." />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Factura original" required error={errors.rectifiesId}>
                <Select value={v.rectifiesId} onChange={(e) => set("rectifiesId", e.target.value)} required>
                  <option value="">Elige una factura</option>
                  {v.rectifiesId && !invoices.some((i) => i.id === v.rectifiesId) ? <option value={v.rectifiesId}>{v.rectifiesNumber ?? "Factura original"}</option> : null}
                  {invoices.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.number} · {formatDateNumeric(i.issueDate)} · {i.customerName} · {formatMoney(i.totalCents)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Motivo" required error={errors.rectificationReason} hint="Error en el precio, devolución, descuento posterior…">
                <Input value={v.rectificationReason} onChange={(e) => set("rectificationReason", e.target.value)} maxLength={500} required />
              </Field>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader title={isDelivery ? "Destinatario" : "Cliente"} description={fiscal ? "Para empresas y autónomos, el NIF y el domicilio son obligatorios en la factura." : undefined} />
          <CardBody className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cliente guardado">
                <Select value={v.customerId} onChange={(e) => pickCustomer(e.target.value)}>
                  <option value="">Escribir los datos a mano</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Nombre o razón social" required error={errors["customer.name"]}>
                <Input value={v.customer.name} onChange={(e) => setCustomer("name", e.target.value)} required maxLength={160} />
              </Field>
              <Field label="NIF / CIF" error={errors["customer.taxId"]}>
                <Input value={v.customer.taxId} onChange={(e) => setCustomer("taxId", e.target.value)} maxLength={30} className="font-mono uppercase" />
              </Field>
              <Field label="Dirección" error={errors["customer.addressLine"]}>
                <Input value={v.customer.addressLine} onChange={(e) => setCustomer("addressLine", e.target.value)} maxLength={200} />
              </Field>
              <Field label="Código postal">
                <Input value={v.customer.postalCode} onChange={(e) => setCustomer("postalCode", e.target.value)} maxLength={20} inputMode="numeric" />
              </Field>
              <Field label="Ciudad">
                <Input value={v.customer.city} onChange={(e) => setCustomer("city", e.target.value)} maxLength={80} />
              </Field>
              <Field label="Provincia">
                <Input value={v.customer.province} onChange={(e) => setCustomer("province", e.target.value)} maxLength={80} />
              </Field>
              <Field label="País">
                <Input value={v.customer.country} onChange={(e) => setCustomer("country", e.target.value)} maxLength={80} />
              </Field>
              <Field label="Correo electrónico">
                <Input type="email" value={v.customer.email} onChange={(e) => setCustomer("email", e.target.value)} maxLength={160} />
              </Field>
              <Field label="Teléfono">
                <Input type="tel" value={v.customer.phone} onChange={(e) => setCustomer("phone", e.target.value)} maxLength={40} />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Líneas" description={`Elige un producto o escribe una línea libre (diseño, horas, piezas a medida…). Precios ${v.pricesIncludeVat ? "con IVA incluido" : "sin IVA"}.`} />
          <CardBody className="flex flex-col gap-3">
            {errors.items ? <p className="text-sm text-danger">{errors.items}</p> : null}
            {lines.map((line, index) => {
              const lineTotal = lineTotalCents(parseDecimal(line.quantity) ?? 0, parseMoneyToCents(line.unitPrice) ?? 0);
              return (
                <div key={line.key} className="grid grid-cols-12 items-end gap-x-3 gap-y-2 border-b border-line pb-3 last:border-b-0 last:pb-0">
                  <Field label={index === 0 ? "Producto" : <span className="sm:sr-only">Producto</span>} className="col-span-12 sm:col-span-3">
                    <Select value={line.productId} onChange={(e) => pickProduct(line.key, e.target.value)} aria-label={`Producto de la línea ${index + 1}`}>
                      <option value="">Línea libre</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={index === 0 ? "Descripción" : <span className="sm:sr-only">Descripción</span>} className={showAmounts ? "col-span-12 sm:col-span-4" : "col-span-9 sm:col-span-7"} error={errors[`items.${index}.description`]}>
                    <Input value={line.description} onChange={(e) => updateLine(line.key, { description: e.target.value })} maxLength={300} aria-label={`Descripción de la línea ${index + 1}`} />
                  </Field>
                  <Field label={index === 0 ? "Cant." : <span className="sm:sr-only">Cantidad</span>} className={showAmounts ? "col-span-3 sm:col-span-1" : "col-span-3 sm:col-span-1"} error={errors[`items.${index}.quantity`]}>
                    <NumberInput value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} aria-label={`Cantidad de la línea ${index + 1}`} />
                  </Field>
                  {showAmounts ? (
                    <Field label={index === 0 ? "Precio" : <span className="sm:sr-only">Precio</span>} className="col-span-5 sm:col-span-2" error={errors[`items.${index}.unitPrice`]}>
                      <MoneyInput value={line.unitPrice} onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })} aria-label={`Precio de la línea ${index + 1}`} />
                    </Field>
                  ) : null}
                  <div className={`${showAmounts ? "col-span-4" : "col-span-12 sm:col-span-1"} flex h-10 items-center justify-end gap-1 sm:col-span-2 pointer-coarse:h-11`}>
                    {showAmounts ? <span className="font-mono text-sm tabular">{formatMoney(lineTotal)}</span> : null}
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
          <CardHeader title="Observaciones y condiciones" description="Salen impresas en el documento." />
          <CardBody className="flex flex-col gap-4">
            <Field label="Observaciones" error={errors.notes}>
              <Textarea value={v.notes} onChange={(e) => set("notes", e.target.value)} rows={2} maxLength={2000} />
            </Field>
            <Field label={kind === "quote" ? "Condiciones del presupuesto" : "Condiciones"} error={errors.terms} hint={kind === "quote" ? "Plazo de entrega, anticipo, tolerancias de impresión, propiedad de los diseños…" : undefined}>
              <Textarea value={v.terms} onChange={(e) => set("terms", e.target.value)} rows={kind === "quote" ? 5 : 2} maxLength={4000} />
            </Field>
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title={v.number ? `${label} ${v.number}` : label} description={v.number ? undefined : "El número se asigna al emitirla, siguiendo la serie."} />
          <CardBody className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Fecha" required error={errors.issueDate}>
                <DateInput value={v.issueDate} onChange={(e) => set("issueDate", e.target.value)} required />
              </Field>
              {dueLabel ? (
                <Field label={dueLabel} error={errors.dueDate}>
                  <DateInput value={v.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
                </Field>
              ) : null}
            </div>
            {v.orderNumber ? <p className="text-sm text-fg-2">Pedido de origen: <span className="font-mono text-fg">{v.orderNumber}</span></p> : null}
            {!isDelivery ? (
              <Field label="Forma de pago">
                <Select value={v.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>
                  <option value="">Sin indicar</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Checkbox label="Mostrar precios e importes" checked={v.showPrices} onChange={(e) => set("showPrices", e.target.checked)} />
            )}
          </CardBody>
        </Card>

        {showAmounts ? (
          <Card>
            <CardHeader title="Importes" />
            <CardBody className="flex flex-col gap-4">
              <Checkbox
                label="Precios con IVA incluido"
                hint="Como en los pedidos y la tienda. Para empresas y profesionales suele ser mejor sin IVA."
                checked={v.pricesIncludeVat}
                onChange={(e) => set("pricesIncludeVat", e.target.checked)}
              />
              <div className="grid grid-cols-2 gap-4">
                <Field label="IVA" required error={errors.vatRatePct}>
                  <NumberInput unit="%" value={v.vatRatePct} onChange={(e) => set("vatRatePct", e.target.value)} />
                </Field>
                {fiscal ? (
                  <Field label="Retención IRPF" error={errors.irpfRatePct} hint="Solo si facturas como autónomo a otra empresa.">
                    <NumberInput unit="%" value={v.irpfRatePct} onChange={(e) => set("irpfRatePct", e.target.value)} />
                  </Field>
                ) : null}
                {!isRect ? (
                  <>
                    <Field label="Descuento" error={errors.discount}>
                      <MoneyInput value={v.discount} onChange={(e) => set("discount", e.target.value)} />
                    </Field>
                    <Field label="Envío" error={errors.shipping}>
                      <MoneyInput value={v.shipping} onChange={(e) => set("shipping", e.target.value)} />
                    </Field>
                  </>
                ) : null}
              </div>
              <dl className="flex flex-col gap-1.5 border-t border-line pt-4 text-sm">
                <div className="flex justify-between">
                  <dt className="text-fg-2">Base imponible</dt>
                  <dd className="font-mono tabular">{formatMoney(totals.baseCents)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fg-2">IVA</dt>
                  <dd className="font-mono tabular">{formatMoney(totals.vatCents)}</dd>
                </div>
                {totals.irpfCents !== 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-fg-2">Retención IRPF</dt>
                    <dd className="font-mono tabular">−{formatMoney(totals.irpfCents)}</dd>
                  </div>
                ) : null}
                <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2.5">
                  <dt className="font-semibold">{totals.irpfCents !== 0 ? "Total a pagar" : "Total"}</dt>
                  <dd className="font-mono text-xl font-medium tabular">{formatMoney(totals.amountDueCents)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row lg:flex-col-reverse">
          <Button href={cancelHref} block>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" size="lg" loading={pending} block>
            {v.id ? "Guardar cambios" : `Emitir ${label.toLowerCase()}`}
          </Button>
        </div>
      </div>
    </form>
  );
}
