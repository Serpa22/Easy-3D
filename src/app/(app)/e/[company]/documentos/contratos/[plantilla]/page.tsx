import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, Printer, RefreshCw } from "lucide-react";
import { ContractPaper } from "@/components/documents/contract-paper";
import { Button, buttonClass } from "@/components/ui/button";
import { Alert, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/display";
import { DateInput, Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import type { SearchParams } from "@/components/ui/nav";
import { buildContract, getContractTemplate } from "@/lib/contract-templates";
import { todayISO } from "@/lib/dates";
import { missingIssuerFields } from "@/lib/documents";
import { requireCompany } from "@/server/context";
import { contractQuery, contractValues, loadContractCustomer, parseContractRequest } from "@/server/domain/contracts";
import { issuerFromCompany } from "@/server/domain/documents-service";
import { listDocumentCustomers } from "@/server/queries/documents";

type Props = { params: Promise<{ company: string; plantilla: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: getContractTemplate((await params).plantilla)?.title ?? "Contrato" };
}

export default async function ContractPage({ params, searchParams }: Props) {
  const { company: slug, plantilla } = await params;
  const { company, db, org } = await requireCompany(slug);
  const template = getContractTemplate(plantilla);
  if (!template) notFound();
  const sp = await searchParams;
  const req = parseContractRequest(template, sp, company, todayISO(org.timeZone));
  const [customerList, customer] = await Promise.all([listDocumentCustomers(db, company.id), loadContractCustomer(db, company.id, req.customerId)]);
  const contract = buildContract(template, contractValues(company, customer, req));
  const base = `/e/${company.slug}/documentos`;
  const missing = missingIssuerFields(issuerFromCompany(company));

  return (
    <>
      <PageHeader
        back={{ href: base, label: "Documentos" }}
        eyebrow="Plantilla de contrato"
        title={template.title}
        description={`${template.summary} Modelo orientativo: revísalo con tu asesor antes de firmarlo.`}
        actions={
          <>
            <Button href={`${base}/contratos/${template.slug}/imprimir?${contractQuery(template, req)}`} variant="primary" icon={<Printer />}>
              Imprimir o PDF
            </Button>
            {/* Archivo estático: enlace normal, sin la navegación de Next. */}
            <a href={`/plantillas/${template.slug}.docx`} download className={buttonClass()}>
              <Download className="size-4" aria-hidden="true" />
              Word en blanco
            </a>
          </>
        }
      />

      {missing.length > 0 ? (
        <Alert tone="warn" title="Faltan tus datos fiscales">
          El contrato saldrá con huecos en tu {missing.join(" y ")}. Complétalos en Ajustes → Datos fiscales.
        </Alert>
      ) : null}

      {/* La hoja mide 210 mm fijos: va al lado del formulario solo cuando cabe entera (≥ 1420 px); si no, debajo. */}
      <div className="grid items-start gap-4 min-[1420px]:grid-cols-[minmax(18rem,24rem)_210mm]">
        <Card>
          <CardHeader title="Datos del contrato" description="Los huecos que dejes vacíos saldrán como una línea para rellenar a mano." />
          <CardBody>
            <form method="get" className="flex flex-col gap-4">
              <input type="hidden" name="enviado" value="1" />
              {template.parties ? (
                <Field label="Cliente" name="cliente" hint={customerList.length === 0 ? "Aún no tienes clientes guardados: el hueco quedará en blanco." : "Usa su NIF y su dirección de la ficha."}>
                  <Select defaultValue={req.customerId ?? ""}>
                    <option value="">Dejar en blanco</option>
                    {customerList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <div className="grid grid-cols-2 gap-4 min-[1420px]:grid-cols-1">
                <Field label="Fecha" name="fecha">
                  <DateInput defaultValue={req.date} />
                </Field>
                {template.parties ? (
                  <Field label="Lugar de firma" name="lugar">
                    <Input defaultValue={req.place} maxLength={80} />
                  </Field>
                ) : null}
              </div>
              {template.fields.map((f) => (
                <Field key={f.key} label={f.label} name={`campo_${f.key}`} hint={f.hint}>
                  {f.type === "textarea" ? (
                    <Textarea defaultValue={req.fields[f.key]} rows={3} maxLength={2000} />
                  ) : f.type === "number" ? (
                    <NumberInput defaultValue={req.fields[f.key]} />
                  ) : (
                    <Input defaultValue={req.fields[f.key]} maxLength={300} />
                  )}
                </Field>
              ))}
              <Button type="submit" icon={<RefreshCw />}>
                Actualizar vista previa
              </Button>
            </form>
          </CardBody>
        </Card>

        <ContractPaper contract={contract} brand={{ name: company.name, accent: company.brandColor, contact: [company.website, company.contactEmail, company.contactPhone] }} />
      </div>
    </>
  );
}
