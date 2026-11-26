import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Copy, FileText, Pencil, Printer, Receipt, ReceiptText, RotateCcw, Trash2, Truck, X } from "lucide-react";
import { z } from "zod";
import { DocumentPaper } from "@/components/documents/document-paper";
import { DocumentKindBadge, DocumentStatusBadge } from "@/components/documents/shared";
import { ActionButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/display";
import { ConfirmButton } from "@/components/ui/dialog";
import { todayISO } from "@/lib/dates";
import { DOCUMENT_KIND_SLUGS, missingIssuerFields } from "@/lib/documents";
import { DOCUMENT_KIND_LABELS, FISCAL_DOCUMENT_KINDS } from "@/lib/domain";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { deleteDocumentAction, setQuoteStatusAction } from "@/server/actions/documents";
import { requireCompany } from "@/server/context";
import { isLastOfSeries } from "@/server/domain/documents-service";
import { getDocument } from "@/server/queries/documents";

type Props = { params: Promise<{ company: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { company: slug, id } = await params;
  const { company, db } = await requireCompany(slug);
  const data = z.uuid().safeParse(id).success ? await getDocument(db, company.id, id) : null;
  return { title: data ? `${DOCUMENT_KIND_LABELS[data.doc.kind]} ${data.doc.number}` : "Documento" };
}

export default async function DocumentPage({ params }: Props) {
  const { company: slugParam, id } = await params;
  const { company, db, org } = await requireCompany(slugParam);
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getDocument(db, company.id, id);
  if (!data) notFound();
  const { doc, items, order, rectifies, rectifiedBy } = data;
  const slug = company.slug;
  const base = `/e/${slug}/documentos`;
  const fiscal = FISCAL_DOCUMENT_KINDS.includes(doc.kind);
  const last = await isLastOfSeries(db, doc);
  const deletable = !fiscal || (last && rectifiedBy.length === 0);
  const newFrom = (kind: keyof typeof DOCUMENT_KIND_SLUGS) => `${base}/nuevo?tipo=${DOCUMENT_KIND_SLUGS[kind]}&desde=${doc.id}`;
  const missing = fiscal ? missingIssuerFields(doc.issuer) : [];
  const label = DOCUMENT_KIND_LABELS[doc.kind];

  return (
    <>
      <PageHeader
        back={{ href: base, label: "Documentos" }}
        eyebrow={`${formatDate(doc.issueDate)}${order ? ` · Pedido ${order.number}` : ""}`}
        title={`${label} ${doc.number}`}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <DocumentKindBadge kind={doc.kind} />
            <DocumentStatusBadge kind={doc.kind} status={doc.status} dueDate={doc.dueDate} today={todayISO(org.timeZone)} />
            <span className="text-fg-3">{doc.customer.name}</span>
          </span>
        }
        actions={
          <>
            <Button href={`${base}/${doc.id}/imprimir`} variant="primary" icon={<Printer />}>
              Imprimir o PDF
            </Button>
            {doc.kind === "quote" ? (
              <Button href={newFrom("invoice")} icon={<Receipt />}>
                Facturar
              </Button>
            ) : null}
            {doc.kind === "invoice" ? (
              <Button href={newFrom("rectifying")} icon={<ReceiptText />}>
                Rectificar
              </Button>
            ) : null}
            <Button href={`${base}/${doc.id}/editar`} icon={<Pencil />}>
              Editar
            </Button>
          </>
        }
      />

      {missing.length > 0 ? (
        <Alert tone="warn" title="A esta factura le faltan datos del emisor">
          No lleva tu {missing.join(" ni ")}. Complétalos en{" "}
          <Link href={`/e/${slug}/ajustes#datos-fiscales`} className="font-medium text-fg underline underline-offset-4 hover:text-fg-2">
            Ajustes
          </Link>{" "}
          y guarda de nuevo la factura (Editar → Guardar cambios) para actualizarla.
        </Alert>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <DocumentPaper doc={doc} items={items} rectifies={rectifies} order={order} />

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Importe" />
            <CardBody>
              {doc.kind === "delivery_note" && !doc.showPrices ? (
                <p className="text-sm text-fg-2">Albarán sin precios.</p>
              ) : (
                <>
                  <p className="font-mono text-2xl font-medium tabular">{formatMoney(doc.amountDueCents)}</p>
                  <p className="mt-1 text-[0.8125rem] text-fg-3">
                    Base {formatMoney(doc.baseCents)} · IVA {formatMoney(doc.vatCents)}
                    {doc.irpfCents ? ` · IRPF −${formatMoney(doc.irpfCents)}` : ""}
                  </p>
                </>
              )}
            </CardBody>
          </Card>

          {doc.kind === "quote" ? (
            <Card>
              <CardHeader title="Respuesta del cliente" />
              <CardBody className="flex flex-wrap gap-2">
                {doc.status !== "accepted" ? (
                  <ActionButton size="sm" icon={<Check />} action={setQuoteStatusAction.bind(null, slug, doc.id, "accepted")}>
                    Aceptado
                  </ActionButton>
                ) : null}
                {doc.status !== "rejected" ? (
                  <ActionButton size="sm" icon={<X />} action={setQuoteStatusAction.bind(null, slug, doc.id, "rejected")}>
                    Rechazado
                  </ActionButton>
                ) : null}
                {doc.status !== "issued" ? (
                  <ActionButton size="sm" icon={<RotateCcw />} action={setQuoteStatusAction.bind(null, slug, doc.id, "issued")}>
                    Volver a pendiente
                  </ActionButton>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Relacionado" />
            <CardBody className="flex flex-col gap-2 text-sm">
              {order ? (
                <p>
                  Pedido{" "}
                  <Link href={`/e/${slug}/pedidos/${order.id}`} className="font-mono underline underline-offset-4 hover:text-fg-2">
                    {order.number}
                  </Link>
                </p>
              ) : null}
              {rectifies ? (
                <p>
                  Rectifica a{" "}
                  <Link href={`${base}/${rectifies.id}`} className="font-mono underline underline-offset-4 hover:text-fg-2">
                    {rectifies.number}
                  </Link>
                </p>
              ) : null}
              {rectifiedBy.map((r) => (
                <p key={r.id}>
                  Rectificada por{" "}
                  <Link href={`${base}/${r.id}`} className="font-mono underline underline-offset-4 hover:text-fg-2">
                    {r.number}
                  </Link>{" "}
                  <span className="text-fg-3">({formatMoney(r.totalCents)})</span>
                </p>
              ))}
              {!order && !rectifies && rectifiedBy.length === 0 ? <p className="text-fg-2">Sin pedido ni documentos asociados.</p> : null}
              <div className="mt-2 flex flex-wrap gap-2 border-t border-line pt-3">
                {doc.kind === "invoice" || doc.kind === "quote" ? (
                  <Button size="sm" href={newFrom("delivery_note")} icon={<Truck />}>
                    Sacar albarán
                  </Button>
                ) : null}
                {doc.kind === "delivery_note" ? (
                  <Button size="sm" href={newFrom("invoice")} icon={<Receipt />}>
                    Facturar
                  </Button>
                ) : null}
                {doc.kind !== "rectifying" ? (
                  <Button size="sm" href={newFrom(doc.kind)} icon={doc.kind === "quote" ? <FileText /> : <Copy />}>
                    Duplicar
                  </Button>
                ) : null}
              </div>
            </CardBody>
          </Card>

          <p className="px-1 text-[0.8125rem] text-fg-3">Última modificación: {formatDateTime(doc.updatedAt, org.timeZone)}</p>

          {deletable ? (
            <ConfirmButton
              action={deleteDocumentAction.bind(null, slug, doc.id)}
              title={`¿Eliminar ${label.toLowerCase()} ${doc.number}?`}
              description={fiscal ? "Es la última de su serie: su número quedará libre para la siguiente. No se puede deshacer." : "No se puede deshacer."}
              confirmLabel="Eliminar"
              icon={<Trash2 />}
              variant="ghost"
              className="self-start text-danger hover:text-danger"
            >
              Eliminar
            </ConfirmButton>
          ) : (
            <p className="px-1 text-[0.8125rem] text-fg-3">
              {rectifiedBy.length > 0 ? "No se puede eliminar porque tiene rectificativas." : "Solo se puede eliminar la última factura de la serie. Para anularla, emite una rectificativa."}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
