import type { Metadata } from "next";
import Link from "next/link";
import { Archive, Trash2 } from "lucide-react";
import { FormDialogButton } from "@/components/ui/actions";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/display";
import { ConfirmButton } from "@/components/ui/dialog";
import { ActionForm, Field, Input, MoneyInput, NumberInput, SubmitButton, Textarea } from "@/components/ui/form";
import { ELECTRICITY_MODE_LABELS } from "@/lib/domain";
import { centsToInput, formatNumber, numberToInput } from "@/lib/format";
import { archiveCompanyAction, deleteCompanyAction, saveCompanyAction, saveCompanyParamsAction } from "@/server/actions/settings";
import { requireCompany } from "@/server/context";

export const metadata: Metadata = { title: "Ajustes" };

export default async function CompanySettingsPage({ params }: { params: Promise<{ company: string }> }) {
  const { company, user } = await requireCompany((await params).company);
  const slug = company.slug;
  const owner = user.role === "owner";
  return (
    <>
      <PageHeader title="Ajustes" description={`Configuración de ${company.name}. Los ajustes de toda la organización están en Ajustes generales.`} />

      <Card>
        <CardHeader title="Datos de la sub-empresa" description={`Dirección en la app: /e/${slug} (no cambia al renombrar).`} />
        <CardBody>
          <ActionForm action={saveCompanyAction.bind(null, slug)} className="max-w-2xl">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre" name="name" required>
                <Input defaultValue={company.name} maxLength={80} />
              </Field>
              <Field label="Actividad" name="activity">
                <Input defaultValue={company.activity ?? ""} maxLength={120} />
              </Field>
              <Field label="Monograma" name="monogram" required hint="De 1 a 3 letras. Identifica a la empresa en el menú.">
                <Input defaultValue={company.monogram ?? ""} maxLength={3} className="font-mono uppercase" />
              </Field>
              <Field label="Prefijo de pedidos" name="orderPrefix" required hint={`Los pedidos nuevos serán ${company.orderPrefix}-${String(company.orderSeq + 1).padStart(4, "0")}.`}>
                <Input defaultValue={company.orderPrefix} maxLength={5} className="font-mono uppercase" />
              </Field>
            </div>
            <Field label="Descripción" name="description">
              <Textarea defaultValue={company.description ?? ""} rows={2} maxLength={500} />
            </Field>
            <div>
              <SubmitButton>Guardar datos</SubmitButton>
            </div>
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Fiscalidad y costes de producción" description="Se usan por defecto en pedidos y gastos, y en el cálculo del coste de cada producto." />
        <CardBody>
          <ActionForm action={saveCompanyParamsAction.bind(null, slug)} className="max-w-2xl">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="IVA por defecto" name="vatRatePct" required>
                <NumberInput unit="%" defaultValue={numberToInput(company.vatRatePct)} />
              </Field>
              <Field label="Mano de obra" name="laborRate" required hint="Coste por hora de tu tiempo o el de tu equipo.">
                <MoneyInput defaultValue={centsToInput(company.laborRateCents)} />
              </Field>
              <Field label="Margen objetivo" name="targetMarginPct" required hint="Sobre el precio sin IVA. Sirve para el precio recomendado.">
                <NumberInput unit="%" defaultValue={numberToInput(company.targetMarginPct)} />
              </Field>
              <Field label="Tasa de fallos" name="failureRatePct" required hint="Porcentaje de impresiones que salen mal. Encarece cada pieza.">
                <NumberInput unit="%" defaultValue={numberToInput(company.failureRatePct)} />
              </Field>
            </div>
            <div>
              <SubmitButton>Guardar parámetros</SubmitButton>
            </div>
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Electricidad" />
        <CardBody className="text-sm text-fg-2">
          Tarifa actual: <span className="text-fg">{ELECTRICITY_MODE_LABELS[company.electricityMode]}</span>
          {company.electricityMode === "fixed" ? ` · ${formatNumber(company.kwhPrice, 4)} €/kWh` : ` · punta ${formatNumber(company.kwhPricePeak, 3)} · llano ${formatNumber(company.kwhPriceFlat, 3)} · valle ${formatNumber(company.kwhPriceValley, 3)} €/kWh`}.{" "}
          <Link href={`/e/${slug}/energia`} className="font-medium text-fg underline underline-offset-4">
            Cambiar en Energía
          </Link>
        </CardBody>
      </Card>

      <Card className="border-danger">
        <CardHeader title="Zona de peligro" description={owner ? undefined : "Solo un propietario puede archivar o eliminar la sub-empresa."} />
        <CardBody className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-sm text-fg-2">
              <span className="font-medium text-fg">Archivar.</span> Desaparece del menú y de la vista de grupo, pero conserva todos sus datos. Se puede recuperar en Ajustes generales.
            </p>
            {owner ? (
              <ConfirmButton action={archiveCompanyAction.bind(null, slug)} title={`¿Archivar ${company.name}?`} description="Dejará de verse en el menú. Podrás recuperarla desde Ajustes generales → Organización." confirmLabel="Archivar" tone="default" variant="secondary" icon={<Archive />}>
                Archivar
              </ConfirmButton>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
            <p className="max-w-xl text-sm text-fg-2">
              <span className="font-medium text-fg">Eliminar definitivamente.</span> Borra la sub-empresa con sus finanzas, pedidos, máquinas, materiales e historial. No se puede deshacer.
            </p>
            {owner ? (
              <FormDialogButton label="Eliminar" icon={<Trash2 />} variant="danger" title={`Eliminar ${company.name}`} description="Esta acción borra todos los datos de la sub-empresa y no se puede deshacer." action={deleteCompanyAction.bind(null, slug)} submitLabel="Eliminar definitivamente">
                <Field label={`Escribe «${company.name}» para confirmar`} name="confirm" required>
                  <Input autoComplete="off" />
                </Field>
              </FormDialogButton>
            ) : null}
          </div>
        </CardBody>
      </Card>
    </>
  );
}
