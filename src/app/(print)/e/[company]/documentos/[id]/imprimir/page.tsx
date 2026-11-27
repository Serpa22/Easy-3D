import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DocumentPaper } from "@/components/documents/document-paper";
import { PrintToolbar } from "@/components/documents/print-toolbar";
import { DOCUMENT_KIND_LABELS } from "@/lib/domain";
import { requireCompany } from "@/server/context";
import { getDocument } from "@/server/queries/documents";

type Props = { params: Promise<{ company: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { company: slug, id } = await params;
  const { company, db } = await requireCompany(slug);
  const data = z.uuid().safeParse(id).success ? await getDocument(db, company.id, id) : null;
  // El título es el nombre de archivo que propone el navegador al guardar en PDF.
  return { title: { absolute: data ? `${DOCUMENT_KIND_LABELS[data.doc.kind]} ${data.doc.number} - ${company.name}` : "Documento" } };
}

export default async function PrintDocumentPage({ params }: Props) {
  const { company: slug, id } = await params;
  const { company, db } = await requireCompany(slug);
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getDocument(db, company.id, id);
  if (!data) notFound();
  return (
    <>
      <PrintToolbar backHref={`/e/${company.slug}/documentos/${data.doc.id}`} backLabel={`Volver a ${data.doc.number}`} hint="En el diálogo: «Guardar como PDF», sin encabezados ni pies." />
      <DocumentPaper doc={data.doc} items={data.items} brandName={company.name} accent={company.brandColor} rectifies={data.rectifies} order={data.order} standalone />
    </>
  );
}
