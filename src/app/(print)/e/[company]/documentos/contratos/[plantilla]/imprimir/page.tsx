import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContractPaper } from "@/components/documents/contract-paper";
import { PrintToolbar } from "@/components/documents/print-toolbar";
import type { SearchParams } from "@/components/ui/nav";
import { buildContract, getContractTemplate } from "@/lib/contract-templates";
import { todayISO } from "@/lib/dates";
import { requireCompany } from "@/server/context";
import { contractQuery, contractValues, loadContractCustomer, parseContractRequest } from "@/server/domain/contracts";

type Props = { params: Promise<{ company: string; plantilla: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { company: slug, plantilla } = await params;
  const { company } = await requireCompany(slug);
  const t = getContractTemplate(plantilla);
  return { title: { absolute: t ? `${t.title} - ${company.name}` : "Contrato" } };
}

export default async function PrintContractPage({ params, searchParams }: Props) {
  const { company: slug, plantilla } = await params;
  const { company, db, org } = await requireCompany(slug);
  const template = getContractTemplate(plantilla);
  if (!template) notFound();
  const req = parseContractRequest(template, await searchParams, company, todayISO(org.timeZone));
  const customer = await loadContractCustomer(db, company.id, req.customerId);
  const contract = buildContract(template, contractValues(company, customer, req));
  return (
    <>
      <PrintToolbar backHref={`/e/${company.slug}/documentos/contratos/${template.slug}?${contractQuery(template, req)}`} backLabel="Volver a editar" hint="En el diálogo: «Guardar como PDF», sin encabezados ni pies." />
      <ContractPaper contract={contract} brand={{ name: company.name, accent: company.brandColor, contact: [company.website, company.contactEmail, company.contactPhone] }} standalone />
    </>
  );
}
