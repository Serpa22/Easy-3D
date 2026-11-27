import type { Metadata } from "next";
import Link from "next/link";
import { Archive, Trash2 } from "lucide-react";
import { FormDialogButton } from "@/components/ui/actions";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/display";
import { ConfirmButton } from "@/components/ui/dialog";
import { ActionForm, ColorInput, Field, Input, MoneyInput, NumberInput, SubmitButton, Textarea } from "@/components/ui/form";
import { ELECTRICITY_MODE_LABELS } from "@/lib/domain";
import { todayISO } from "@/lib/dates";
import { formatDocumentNumber } from "@/lib/documents";
import { centsToInput, formatNumber, numberToInput } from "@/lib/format";
import { saveBillingAction, saveDocumentSettingsAction } from "@/server/actions/documents";
import { archiveCompanyAction, deleteCompanyAction, saveCompanyAction, saveCompanyParamsAction } from "@/server/actions/settings";
import { requireCompany } from "@/server/context";

export const metadata: Metadata = { title: "Ajustes" };

export default async function CompanySettingsPage({ params }: { params: Promise<{ company: string }> }) {
  const { company, user, org } = await requireCompany((await params).company);
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

      <Card id="datos-fiscales" className="scroll-mt-20">
        <CardHeader title="Datos fiscales" description="Salen como emisor en facturas, presupuestos, albaranes y contratos. Una factura completa necesita al menos el NIF y el domicilio fiscal." />
        <CardBody>
          <ActionForm action={saveBillingAction.bind(null, slug)} className="max-w-2xl">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Razón social o nombre del titular" name="legalName" hint={`Si lo dejas vacío se usa «${company.name}».`}>
                <Input defaultValue={company.legalName ?? ""} maxLength={160} autoComplete="organization" />
              </Field>
              <Field label="NIF / CIF" name="taxId">
                <Input defaultValue={company.taxId ?? ""} maxLength={20} className="font-mono uppercase" />
              </Field>
              <Field label="Domicilio fiscal" name="fiscalAddressLine" className="sm:col-span-2">
                <Input defaultValue={company.fiscalAddressLine ?? ""} maxLength={200} autoComplete="street-address" />
              </Field>
              <Field label="Código postal" name="fiscalPostalCode">
                <Input defaultValue={company.fiscalPostalCode ?? ""} maxLength={20} inputMode="numeric" autoComplete="postal-code" />
              </Field>
              <Field label="Ciudad" name="fiscalCity">
                <Input defaultValue={company.fiscalCity ?? ""} maxLength={80} autoComplete="address-level2" />
              </Field>
              <Field label="Provincia" name="fiscalProvince">
                <Input defaultValue={company.fiscalProvince ?? ""} maxLength={80} autoComplete="address-level1" />
              </Field>
              <Field label="País" name="fiscalCountry">
                <Input defaultValue={company.fiscalCountry ?? "España"} maxLength={80} autoComplete="country-name" />
              </Field>
              <Field label="Correo de contacto" name="contactEmail">
                <Input type="email" defaultValue={company.contactEmail ?? ""} maxLength={160} autoComplete="email" />
              </Field>
              <Field label="Teléfono" name="contactPhone">
                <Input type="tel" defaultValue={company.contactPhone ?? ""} maxLength={40} autoComplete="tel" />
              </Field>
              <Field label="Web" name="website">
                <Input defaultValue={company.website ?? ""} maxLength={160} placeholder="www.tutienda.es" />
              </Field>
              <Field label="IBAN para transferencias" name="iban" hint="Sale en las facturas cuyo pago es por transferencia.">
                <Input defaultValue={company.iban ?? ""} maxLength={42} className="font-mono uppercase" autoComplete="off" />
              </Field>
            </div>
            <div>
              <SubmitButton>Guardar datos fiscales</SubmitButton>
            </div>
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Documentos" description="Series de numeración, plazos y textos por defecto. Cada serie empieza de nuevo cada año." />
        <CardBody>
          <ActionForm action={saveDocumentSettingsAction.bind(null, slug)} className="max-w-2xl">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Serie de facturas" name="invoicePrefix" required hint={`Ejemplo: ${formatDocumentNumber(company.invoicePrefix, Number(todayISO(org.timeZone).slice(0, 4)), 1)}`}>
                <Input defaultValue={company.invoicePrefix} maxLength={6} className="font-mono uppercase" />
              </Field>
              <Field label="Serie de rectificativas" name="rectifyingPrefix" required hint="Debe ser distinta de la de facturas.">
                <Input defaultValue={company.rectifyingPrefix} maxLength={6} className="font-mono uppercase" />
              </Field>
              <Field label="Serie de presupuestos" name="quotePrefix" required>
                <Input defaultValue={company.quotePrefix} maxLength={6} className="font-mono uppercase" />
              </Field>
              <Field label="Serie de albaranes" name="deliveryPrefix" required>
                <Input defaultValue={company.deliveryPrefix} maxLength={6} className="font-mono uppercase" />
              </Field>
              <Field label="Vencimiento de facturas" name="paymentTermsDays" required hint="Días desde la emisión. 0 = al contado.">
                <NumberInput unit="días" defaultValue={String(company.paymentTermsDays)} />
              </Field>
              <Field label="Validez de presupuestos" name="quoteValidityDays" required>
                <NumberInput unit="días" defaultValue={String(company.quoteValidityDays)} />
              </Field>
              <Field label="Retención de IRPF por defecto" name="irpfRatePct" required hint="Solo autónomos que facturan a empresas (normalmente 15 % o 7 % los primeros años).">
                <NumberInput unit="%" defaultValue={numberToInput(company.irpfRatePct)} />
              </Field>
            </div>
            <Field label="Condiciones de los presupuestos" name="quoteTerms" hint="Se proponen al crear un presupuesto; se pueden cambiar en cada uno.">
              <Textarea defaultValue={company.quoteTerms ?? ""} rows={4} maxLength={4000} placeholder="Plazo de fabricación: 7 días hábiles desde la aceptación. Anticipo del 50 %. Tolerancia dimensional ±0,3 mm…" />
            </Field>
            <Field label="Pie de página" name="documentFooter" hint="Inscripción en el Registro Mercantil, aviso de protección de datos…">
              <Textarea defaultValue={company.documentFooter ?? ""} rows={3} maxLength={1000} />
            </Field>
            <Field label="Color de marca en documentos" name="brandColor" hint="Acento de facturas, presupuestos, albaranes y contratos: logotipo, número y total. El resto de la hoja va en negro sobre blanco.">
              <ColorInput defaultValue={company.brandColor} />
            </Field>
            <div>
              <SubmitButton>Guardar documentos</SubmitButton>
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
