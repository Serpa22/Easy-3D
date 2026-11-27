import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { DOCUMENT_DUE_LABEL, accentTokens, partyAddressLines, titleSize, totalSize, typographicMinus, type DocumentParty } from "@/lib/documents";
import { DOCUMENT_KIND_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/domain";
import { formatDateNumeric, formatMoney, formatNumber } from "@/lib/format";
import type { DocumentItem, DocumentRow } from "@/server/db/schema";

/** Marca que encabeza la hoja: nombre comercial de la sub-empresa, su color y el contacto. */
export interface PaperBrand {
  /** Nombre comercial (`companies.name`), no la razón social. */
  name: string;
  /** Color de marca #RRGGBB (`companies.brandColor`); si no es válido se usa el de por defecto. */
  accent?: string | null;
  /** Web, correo, teléfono… Los vacíos se omiten. */
  contact?: Array<string | null | undefined>;
}

/**
 * `standalone`: la hoja es todo el contenido de la página (impresión) y su
 * titular es el `h1`. Dentro de la app el `h1` lo pone `PageHeader`, así que
 * los encabezados de la hoja bajan un nivel.
 */
type Level = { standalone?: boolean };

/**
 * Hoja A4 de un documento: la misma para la vista previa y para imprimir o
 * guardar en PDF. Siempre clara, sea cual sea el tema de la app, y la única
 * zona con color de marca (tokens `--doc-*` de `globals.css`). Está maquetada
 * en mm/pt, así que en pantallas estrechas se desplaza dentro de su marco.
 */
export function Paper({ accent, contract, children }: { accent?: string | null; contract?: boolean; children: ReactNode }) {
  const tokens = accentTokens(accent);
  const style = { "--doc-accent": tokens.accent, "--doc-accent-ink": tokens.ink, "--doc-accent-ink-sm": tokens.inkSmall, "--doc-accent-fg": tokens.fg } as CSSProperties;
  return (
    <div className="paper-frame theme-light scroll-x bg-bg">
      <article lang="es" className={cn("paper", contract && "paper--contrato")} style={style}>
        {children}
      </article>
    </div>
  );
}

/** Cabecera de la hoja: logotipo-tecla + nombre comercial, y contacto a la derecha. */
export function PaperHeader({ brand }: { brand: PaperBrand }) {
  const contact = (brand.contact ?? []).filter(Boolean);
  return (
    <header className="doc-cab">
      <p className="doc-marca">
        <span className="doc-marca__tecla" aria-hidden />
        <span className="doc-marca__nombre">{brand.name}</span>
      </p>
      {contact.length > 0 ? (
        <p className="doc-cab__dcha">
          {contact.map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </p>
      ) : null}
    </header>
  );
}

/** Rótulo en mayúsculas con su cuadradito-tecla, como encabezado de bloque. */
function Rotulo({ standalone, children }: Level & { children: ReactNode }) {
  const Tag = standalone ? "h2" : "h3";
  return <Tag className="doc-rotulo">{children}</Tag>;
}

function Party({ title, party, standalone }: Level & { title: string; party: DocumentParty }) {
  const address = partyAddressLines(party);
  const hasContact = Boolean(party.email || party.phone);
  return (
    <section className="doc-parte">
      <Rotulo standalone={standalone}>{title}</Rotulo>
      <p className="doc-parte__nombre">{party.name}</p>
      {party.taxId || address.length > 0 || hasContact ? (
        <p>
          {party.taxId ? <b>NIF {party.taxId}</b> : null}
          {address.map((l, i) => (
            <span key={i}>
              {i > 0 || party.taxId ? <br /> : null}
              {l}
            </span>
          ))}
          {hasContact ? (
            <>
              {party.taxId || address.length > 0 ? <br /> : null}
              {party.email}
              {party.email && party.phone ? " · " : null}
              {/* El teléfono no se parte: en columnas estrechas baja entero a la línea siguiente. */}
              {party.phone ? <span className="doc-nowrap">{party.phone}</span> : null}
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

function Datum({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="doc-rotulo doc-rotulo--liso">{label}</dt>
      <dd className="doc-dato">{value}</dd>
    </div>
  );
}

function Sum({ label, value, base }: { label: ReactNode; value: ReactNode; base?: boolean }) {
  return (
    <>
      <dt className={base ? "doc-base" : undefined}>{label}</dt>
      <dd className={base ? "doc-base" : undefined}>{value}</dd>
    </>
  );
}

function Block({ title, standalone, children }: Level & { title: string; children: ReactNode }) {
  return (
    <section className="doc-bloque">
      <Rotulo standalone={standalone}>{title}</Rotulo>
      {children}
    </section>
  );
}

const pct = (v: number) => `${formatNumber(v, 2)} %`;
/** Importes y cantidades de la hoja: los negativos (rectificativas) con «−», no con guion. */
const money = (cents: number) => typographicMinus(formatMoney(cents));
const qty = (value: number) => typographicMinus(formatNumber(value, 3));

export interface DocumentPaperProps extends Level {
  doc: DocumentRow;
  items: DocumentItem[];
  /** Nombre comercial de la sub-empresa (la razón social va en «Emisor»). */
  brandName: string;
  /** Color de marca de la sub-empresa. */
  accent?: string | null;
  rectifies?: { number: string; issueDate: string } | null;
  order?: { number: string } | null;
}

export function DocumentPaper({ doc, items, brandName, accent, rectifies, order, standalone }: DocumentPaperProps) {
  const prices = doc.kind !== "delivery_note" || doc.showPrices;
  const dueLabel = DOCUMENT_DUE_LABEL[doc.kind];
  const transfer = doc.paymentMethod === "transfer" || (doc.kind === "invoice" && !doc.paymentMethod && doc.issuer.iban);
  const payment = doc.kind !== "delivery_note" && (doc.paymentMethod || transfer) ? (doc.paymentMethod ? PAYMENT_METHOD_LABELS[doc.paymentMethod] : "Transferencia") : null;
  const priceNote = doc.pricesIncludeVat ? "IVA incl." : "sin IVA";
  const withIrpf = doc.irpfCents !== 0;
  const title = titleSize(DOCUMENT_KIND_LABELS[doc.kind]);
  const Title = standalone ? "h1" : "h2";
  const rectification = doc.kind === "rectifying";
  const hasNotes = Boolean(payment || doc.notes || doc.terms);
  const total = money(withIrpf ? doc.amountDueCents : doc.totalCents);
  const totalFit = totalSize(total);

  return (
    <Paper accent={accent}>
      <PaperHeader brand={{ name: brandName, contact: [doc.issuer.website, doc.issuer.email, doc.issuer.phone] }} />

      <div className="doc-col12 doc-portada">
        <Title className={cn("doc-titular", `doc-titular--${title.size}`)}>
          {title.lines.map((line, i) => (
            <span key={i}>
              {line}
              {i < title.lines.length - 1 ? " " : null}
            </span>
          ))}
        </Title>
        <p className="doc-portada__num">
          <span className="doc-rotulo">Número</span>
          <strong>{doc.number}</strong>
        </p>
      </div>

      <dl className="doc-datos">
        <Datum label="Fecha" value={formatDateNumeric(doc.issueDate)} />
        {dueLabel && doc.dueDate ? <Datum label={dueLabel} value={formatDateNumeric(doc.dueDate)} /> : null}
        {rectification && rectifies ? <Datum label="Rectifica a" value={rectifies.number} /> : null}
        {order ? <Datum label="Pedido" value={order.number} /> : null}
        {doc.kind === "invoice" && payment ? <Datum label="Forma de pago" value={payment} /> : null}
      </dl>

      <div className={cn("doc-col12 doc-partes", rectification && "doc-partes--3")}>
        <Party title="Emisor" party={doc.issuer} standalone={standalone} />
        <Party title={doc.kind === "delivery_note" ? "Destinatario" : "Cliente"} party={doc.customer} standalone={standalone} />
        {rectification ? (
          <section className="doc-parte">
            <Rotulo standalone={standalone}>Rectificación</Rotulo>
            {rectifies ? (
              <p>
                Rectifica la factura <b>{rectifies.number}</b> del {formatDateNumeric(rectifies.issueDate)}.
              </p>
            ) : null}
            {doc.rectificationReason ? <p>Motivo: {doc.rectificationReason}</p> : null}
          </section>
        ) : null}
      </div>

      <table className="doc-lineas">
        <thead>
          <tr>
            <th scope="col" className="doc-ord">
              <span className="sr-only">N.º</span>
            </th>
            <th scope="col">Concepto</th>
            <th scope="col" className="doc-n">
              {prices ? "Cant." : "Cantidad"}
            </th>
            {prices ? (
              <>
                <th scope="col" className="doc-n">
                  Precio <small>({priceNote})</small>
                </th>
                <th scope="col" className="doc-n">
                  Importe
                </th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const [first, ...rest] = item.description.split("\n");
            const more = rest.join("\n").trim();
            return (
              <tr key={item.id}>
                <td className="doc-ord">{String(i + 1).padStart(2, "0")}</td>
                <td className="doc-concepto">
                  <b>{first}</b>
                  {more ? <span>{more}</span> : null}
                </td>
                <td className={cn("doc-n", !prices && "doc-imp")}>{qty(item.quantity)}</td>
                {prices ? (
                  <>
                    <td className="doc-n">{money(item.unitPriceCents)}</td>
                    <td className="doc-n doc-imp">{money(item.totalCents)}</td>
                  </>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>

      {prices || hasNotes ? (
        <div className="doc-col12 doc-cierre">
          <div className="doc-cierre__izq">
            {payment ? (
              <Block title="Forma de pago" standalone={standalone}>
                <p>{payment}</p>
                {transfer && doc.issuer.iban ? (
                  <p className="doc-iban">
                    <span className="sr-only">IBAN </span>
                    {doc.issuer.iban.replace(/(.{4})/g, "$1 ").trim()}
                  </p>
                ) : null}
              </Block>
            ) : null}
            {doc.notes ? (
              <Block title="Observaciones" standalone={standalone}>
                <p>{doc.notes}</p>
              </Block>
            ) : null}
            {doc.terms ? (
              <Block title="Condiciones" standalone={standalone}>
                <p>{doc.terms}</p>
              </Block>
            ) : null}
          </div>
          {prices ? (
            <div className="doc-cierre__dcha">
              <dl className="doc-sumas">
                {doc.discountCents !== 0 || doc.shippingCents !== 0 ? <Sum label="Subtotal" value={money(doc.subtotalCents)} /> : null}
                {doc.discountCents !== 0 ? <Sum label="Descuento" value={money(-doc.discountCents)} /> : null}
                {doc.shippingCents !== 0 ? <Sum label="Envío" value={money(doc.shippingCents)} /> : null}
                <Sum label="Base imponible" value={money(doc.baseCents)} base />
                <Sum label={`IVA (${pct(doc.vatRatePct)})`} value={money(doc.vatCents)} />
                {withIrpf ? (
                  <>
                    <Sum label="Total" value={money(doc.totalCents)} />
                    <Sum label={`Retención IRPF (${pct(doc.irpfRatePct)})`} value={money(-doc.irpfCents)} />
                  </>
                ) : null}
              </dl>
              {/* La última cifra va en la tecla: el único bloque de color de la hoja. */}
              <dl className={cn("doc-total", totalFit !== "normal" && `doc-total--${totalFit}`)}>
                <dt>
                  {withIrpf ? (
                    <>
                      <span>Total </span>
                      <span>a pagar</span>
                    </>
                  ) : (
                    "Total"
                  )}
                </dt>
                <dd>{total}</dd>
              </dl>
            </div>
          ) : null}
        </div>
      ) : null}

      {doc.kind === "quote" ? (
        <SignatureBoxes
          boxes={[
            { label: "Aceptado por el cliente", note: "Nombre, firma y sello" },
            { label: "Fecha", note: "Fecha de aceptación" },
          ]}
        />
      ) : doc.kind === "delivery_note" ? (
        <SignatureBoxes
          boxes={[
            { label: "Entregado por", note: "Nombre y firma" },
            { label: "Recibí conforme", note: "Nombre, DNI y firma" },
          ]}
        />
      ) : null}

      {doc.footer ? (
        <footer className="doc-pie">
          <p>{doc.footer}</p>
        </footer>
      ) : null}
    </Paper>
  );
}

export interface SignatureBox {
  label: string;
  /** Qué se espera en el hueco («Nombre, DNI y firma»). */
  note?: string;
  /** Quién firma, ya conocido (contratos). */
  name?: string;
}

/** Cajas de firma: teclas en contorno con un hueco para firmar. */
export function SignatureBoxes({ boxes }: { boxes: SignatureBox[] }) {
  return (
    <div className="doc-col12 doc-firmas avoid-break">
      {boxes.map((b, i) => (
        <div key={i} className="doc-firma">
          <p className="doc-rotulo">{b.label}</p>
          <div className="doc-firma__hueco" />
          {b.name ? <p className="doc-firma__quien">{b.name}</p> : null}
          {b.note ? <p className="doc-firma__nota">{b.note}</p> : null}
        </div>
      ))}
    </div>
  );
}
