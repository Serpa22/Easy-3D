import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { DOCUMENT_DUE_LABEL, partyAddressLines, type DocumentParty } from "@/lib/documents";
import { DOCUMENT_KIND_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/domain";
import { formatDateNumeric, formatMoney, formatNumber } from "@/lib/format";
import type { DocumentItem, DocumentRow } from "@/server/db/schema";

/**
 * Hoja A4 de un documento: la misma para la vista previa y para imprimir o
 * guardar en PDF. Siempre en tema claro (`theme-light`), sea cual sea el de la app.
 */
export function Paper({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("paper theme-light mx-auto w-full max-w-[210mm] rounded-lg border border-line bg-bg p-6 text-[0.8125rem] leading-relaxed text-fg shadow-pop sm:p-10", className)}>
      {children}
    </div>
  );
}

function Party({ title, party }: { title?: string; party: DocumentParty }) {
  const lines = partyAddressLines(party);
  return (
    <div className="min-w-0">
      {title ? <p className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-3">{title}</p> : null}
      <p className="font-semibold text-fg">{party.name}</p>
      {party.taxId ? <p className="text-fg-2">NIF {party.taxId}</p> : null}
      {lines.map((l) => (
        <p key={l} className="text-fg-2">
          {l}
        </p>
      ))}
      {party.email || party.phone ? <p className="text-fg-2">{[party.email, party.phone].filter(Boolean).join(" · ")}</p> : null}
      {party.website ? <p className="text-fg-2">{party.website}</p> : null}
    </div>
  );
}

function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-6", strong && "border-t border-line-strong pt-2 text-[0.9375rem] font-semibold")}>
      <dt className={strong ? "text-fg" : "text-fg-2"}>{label}</dt>
      <dd className="font-mono tabular">{value}</dd>
    </div>
  );
}

const pct = (v: number) => `${formatNumber(v, 2)} %`;

export interface DocumentPaperProps {
  doc: DocumentRow;
  items: DocumentItem[];
  rectifies?: { number: string; issueDate: string } | null;
  order?: { number: string } | null;
}

export function DocumentPaper({ doc, items, rectifies, order }: DocumentPaperProps) {
  const prices = doc.kind !== "delivery_note" || doc.showPrices;
  const dueLabel = DOCUMENT_DUE_LABEL[doc.kind];
  const transfer = doc.paymentMethod === "transfer" || (doc.kind === "invoice" && !doc.paymentMethod && doc.issuer.iban);
  const priceNote = doc.pricesIncludeVat ? "IVA incl." : "sin IVA";

  return (
    <Paper>
      {/* Cabecera */}
      <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <Party party={doc.issuer} />
        <div className="sm:text-right">
          <p className="text-xl font-semibold uppercase tracking-wide text-fg">{DOCUMENT_KIND_LABELS[doc.kind]}</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 sm:inline-grid sm:text-left">
            <dt className="text-fg-3">Número</dt>
            <dd className="font-mono font-medium tabular">{doc.number}</dd>
            <dt className="text-fg-3">Fecha</dt>
            <dd className="tabular">{formatDateNumeric(doc.issueDate)}</dd>
            {dueLabel && doc.dueDate ? (
              <>
                <dt className="text-fg-3">{dueLabel}</dt>
                <dd className="tabular">{formatDateNumeric(doc.dueDate)}</dd>
              </>
            ) : null}
            {order ? (
              <>
                <dt className="text-fg-3">Pedido</dt>
                <dd className="font-mono tabular">{order.number}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </header>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div className="rounded-md border border-line p-4">
          <Party title={doc.kind === "delivery_note" ? "Destinatario" : "Cliente"} party={doc.customer} />
        </div>
        {doc.kind === "rectifying" ? (
          <div className="rounded-md border border-line p-4">
            <p className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-3">Rectificación</p>
            {rectifies ? (
              <p>
                Rectifica la factura <span className="font-mono font-medium">{rectifies.number}</span> del {formatDateNumeric(rectifies.issueDate)}.
              </p>
            ) : null}
            {doc.rectificationReason ? <p className="mt-1 text-fg-2">Motivo: {doc.rectificationReason}</p> : null}
          </div>
        ) : null}
      </div>

      {/* Líneas */}
      <table className="mt-8 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line-strong text-[0.6875rem] uppercase tracking-wider text-fg-3">
            <th scope="col" className="py-2 pr-3 font-medium">Descripción</th>
            <th scope="col" className="w-16 py-2 pr-3 text-right font-medium">Cant.</th>
            {prices ? (
              <>
                <th scope="col" className="w-28 py-2 pr-3 text-right font-medium">Precio <span className="normal-case tracking-normal">({priceNote})</span></th>
                <th scope="col" className="w-28 py-2 text-right font-medium">Importe</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-line align-top">
              <td className="py-2 pr-3 whitespace-pre-wrap">{item.description}</td>
              <td className="py-2 pr-3 text-right font-mono tabular">{formatNumber(item.quantity, 3)}</td>
              {prices ? (
                <>
                  <td className="py-2 pr-3 text-right font-mono tabular">{formatMoney(item.unitPriceCents)}</td>
                  <td className="py-2 text-right font-mono tabular">{formatMoney(item.totalCents)}</td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totales */}
      {prices ? (
        <div className="avoid-break mt-6 flex justify-end">
          <dl className="flex w-full max-w-xs flex-col gap-1">
            {doc.discountCents !== 0 || doc.shippingCents !== 0 ? <Row label="Subtotal" value={formatMoney(doc.subtotalCents)} /> : null}
            {doc.discountCents !== 0 ? <Row label="Descuento" value={`−${formatMoney(doc.discountCents)}`} /> : null}
            {doc.shippingCents !== 0 ? <Row label="Envío" value={formatMoney(doc.shippingCents)} /> : null}
            <Row label="Base imponible" value={formatMoney(doc.baseCents)} />
            <Row label={`IVA (${pct(doc.vatRatePct)})`} value={formatMoney(doc.vatCents)} />
            <Row label="Total" value={formatMoney(doc.totalCents)} strong={doc.irpfCents === 0} />
            {doc.irpfCents !== 0 ? (
              <>
                <Row label={`Retención IRPF (${pct(doc.irpfRatePct)})`} value={`−${formatMoney(doc.irpfCents)}`} />
                <Row label="Total a pagar" value={formatMoney(doc.amountDueCents)} strong />
              </>
            ) : null}
          </dl>
        </div>
      ) : null}

      {/* Pago, observaciones y condiciones */}
      <div className="mt-8 flex flex-col gap-4">
        {doc.kind !== "delivery_note" && (doc.paymentMethod || transfer) ? (
          <section className="avoid-break">
            <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider text-fg-3">Forma de pago</h2>
            <p className="mt-1">
              {doc.paymentMethod ? PAYMENT_METHOD_LABELS[doc.paymentMethod] : "Transferencia"}
              {transfer && doc.issuer.iban ? (
                <>
                  {" · "}IBAN <span className="font-mono tabular">{doc.issuer.iban.replace(/(.{4})/g, "$1 ").trim()}</span>
                </>
              ) : null}
            </p>
          </section>
        ) : null}
        {doc.notes ? (
          <section className="avoid-break">
            <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider text-fg-3">Observaciones</h2>
            <p className="mt-1 whitespace-pre-wrap">{doc.notes}</p>
          </section>
        ) : null}
        {doc.terms ? (
          <section className="avoid-break">
            <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider text-fg-3">Condiciones</h2>
            <p className="mt-1 whitespace-pre-wrap text-fg-2">{doc.terms}</p>
          </section>
        ) : null}
      </div>

      {doc.kind === "quote" ? (
        <SignatureBoxes boxes={["Aceptado por el cliente", "Fecha"]} />
      ) : doc.kind === "delivery_note" ? (
        <SignatureBoxes boxes={["Entregado por", "Recibí conforme (nombre, DNI y firma)"]} />
      ) : null}

      {doc.footer ? <footer className="mt-10 border-t border-line pt-3 text-[0.6875rem] whitespace-pre-wrap text-fg-3">{doc.footer}</footer> : null}
    </Paper>
  );
}

export function SignatureBoxes({ boxes }: { boxes: string[] }) {
  return (
    <div className="avoid-break mt-10 grid gap-6 sm:grid-cols-2">
      {boxes.map((b) => (
        <div key={b} className="flex h-28 flex-col justify-end rounded-md border border-line p-3">
          <p className="border-t border-line-strong pt-1.5 text-[0.75rem] text-fg-3">{b}</p>
        </div>
      ))}
    </div>
  );
}
