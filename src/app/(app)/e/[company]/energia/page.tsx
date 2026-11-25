import type { Metadata } from "next";
import { Pencil, Plus, Trash2, Zap } from "lucide-react";
import { BarChart } from "@/components/charts/bar-chart";
import { BarList, StackedBar } from "@/components/charts/simple";
import { EnergySimulator, TariffToday } from "@/components/energy/tariff-live";
import { ActionsMenu, FormDialogButton } from "@/components/ui/actions";
import { Alert, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat, StatGrid } from "@/components/ui/display";
import { DateInput, Field, Input, MoneyInput, NumberInput, Select } from "@/components/ui/form";
import { FilterChips, MonthNav, hrefWith, param, type SearchParams } from "@/components/ui/nav";
import { DataTable } from "@/components/ui/table";
import { addMonths, isISOMonth, lastMonths, monthOf, monthRange, startOfDayInZone, todayISO } from "@/lib/dates";
import { ELECTRICITY_MODE_LABELS, TARIFF_PERIOD_LABELS } from "@/lib/domain";
import { centsToInput, formatDateShort, formatHours, formatKwh, formatMoney, formatMonth, formatMonthShort, formatNumber, formatPercent, numberToInput } from "@/lib/format";
import { deleteEnergyBillAction, saveEnergyBillAction, saveTariffAction } from "@/server/actions/energy";
import { requireCompany } from "@/server/context";
import type { EnergyBill } from "@/server/db/schema";
import { getEnergyByMonth, getEnergyMonth, listEnergyBills } from "@/server/queries/energy";
import { listMachineOptions } from "@/server/queries/machines";

export const metadata: Metadata = { title: "Energía" };

function BillFields({ bill, defaults }: { bill?: EnergyBill; defaults: { from: string; to: string } }) {
  return (
    <>
      {bill ? <input type="hidden" name="id" value={bill.id} /> : null}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Desde" name="periodStart" required>
          <DateInput defaultValue={bill?.periodStart ?? defaults.from} />
        </Field>
        <Field label="Hasta" name="periodEnd" required>
          <DateInput defaultValue={bill?.periodEnd ?? defaults.to} />
        </Field>
        <Field label="Consumo facturado" name="kwh">
          <NumberInput unit="kWh" defaultValue={bill ? numberToInput(bill.kwh) : ""} />
        </Field>
        <Field label="Importe (IVA incluido)" name="amount" required>
          <MoneyInput defaultValue={centsToInput(bill?.amountCents)} />
        </Field>
      </div>
      <Field label="Comercializadora" name="provider">
        <Input defaultValue={bill?.provider ?? ""} maxLength={120} />
      </Field>
      <Field label="Nota" name="note">
        <Input defaultValue={bill?.note ?? ""} maxLength={300} />
      </Field>
      <p className="text-[0.8125rem] text-fg-3">La factura se apunta como gasto de electricidad en Finanzas, con fecha del fin del periodo.</p>
    </>
  );
}

export default async function EnergyPage({ params, searchParams }: { params: Promise<{ company: string }>; searchParams: Promise<SearchParams> }) {
  const { company, db, org } = await requireCompany((await params).company);
  const sp = await searchParams;
  const slug = company.slug;
  const basePath = `/e/${slug}/energia`;
  const tz = org.timeZone;
  const today = todayISO(tz);
  const currentMonth = monthOf(today);
  const rawMonth = param(sp, "mes");
  const month = isISOMonth(rawMonth) && rawMonth <= currentMonth ? rawMonth : currentMonth;
  const withIdle = param(sp, "reposo") === "1";
  const from = startOfDayInZone(monthRange(month).from, tz);
  const to = startOfDayInZone(`${addMonths(month, 1)}-01`, tz);
  const months = lastMonths(12, currentMonth);

  const [data, series, bills, machines] = await Promise.all([
    getEnergyMonth(db, company.id, from, to, tz, new Date()),
    getEnergyByMonth(db, company.id, months, tz, startOfDayInZone(`${months[0]}-01`, tz)),
    listEnergyBills(db, company.id),
    listMachineOptions(db, company.id),
  ]);
  const tou = company.electricityMode === "tou";
  const periodTotal = data.byPeriod.peak + data.byPeriod.flat + data.byPeriod.valley;
  const valleyShare = periodTotal > 0 ? (data.byPeriod.valley / periodTotal) * 100 : null;
  const peakShare = periodTotal > 0 ? (data.byPeriod.peak / periodTotal) * 100 : 0;
  const totalKwh = data.kwh + (withIdle ? data.idleKwh : 0);
  const explained = series.filter((s) => s.billedKwh && s.billedKwh > 0 && s.estimatedKwh > 0).at(-1);
  const prevMonth = monthRange(addMonths(currentMonth, -1));
  const tariff = { electricityMode: company.electricityMode, kwhPrice: company.kwhPrice, kwhPricePeak: company.kwhPricePeak, kwhPriceFlat: company.kwhPriceFlat, kwhPriceValley: company.kwhPriceValley };
  const billButton = (
    <FormDialogButton label="Registrar factura" icon={<Plus />} variant="primary" title="Registrar factura de luz" action={saveEnergyBillAction.bind(null, slug)} submitLabel="Registrar">
      <BillFields defaults={prevMonth} />
    </FormDialogButton>
  );

  return (
    <>
      <PageHeader title="Energía" description="Lo que gastan de luz tus máquinas: estimado a partir de cada impresión y contrastado con tus facturas reales." actions={billButton} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={month} basePath={basePath} searchParams={sp} maxMonth={currentMonth} />
        <FilterChips label="Opciones" items={[{ href: hrefWith(basePath, sp, { reposo: withIdle ? null : 1 }), label: "Incluir consumo en reposo", current: withIdle }]} />
      </div>

      <StatGrid cols={4}>
        <Stat label="Consumo estimado" value={formatKwh(totalKwh)} hint={withIdle ? `Incluye ${formatKwh(data.idleKwh)} en reposo (estimación)` : "Solo impresión"} icon={<Zap />} />
        <Stat label="Coste estimado" value={formatMoney(data.costCents)} hint="De las impresiones del mes" />
        <Stat label="Coste por hora de impresión" value={data.seconds > 0 ? formatMoney(Math.round(data.costCents / (data.seconds / 3600))) : "—"} hint={formatHours(data.seconds)} />
        {tou ? <Stat label="Consumo en valle" value={valleyShare === null ? "—" : formatPercent(valleyShare)} hint="Cuanto más, mejor" /> : <Stat label="Precio" value={`${formatNumber(company.kwhPrice, 4)} €`} hint="por kWh" />}
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Consumo estimado y facturado" description="Últimos 12 meses, en kWh" />
          <CardBody>
            <BarChart
              data={series.map((s) => ({ label: formatMonthShort(s.month), fullLabel: formatMonth(s.month), values: { est: s.estimatedKwh, bill: s.billedKwh ?? 0 } }))}
              series={[
                { key: "est", label: "Estimado (impresión)" },
                { key: "bill", label: "Facturado" },
              ]}
              format="kwh"
              height={220}
              ariaLabel="kWh estimados y facturados por mes"
              categoryLabel="Mes"
            />
            {explained ? (
              <p className="mt-3 text-sm text-fg-2">
                La impresión explica aproximadamente el <span className="font-medium text-fg">{formatPercent(Math.min(100, (explained.estimatedKwh / explained.billedKwh!) * 100))}</span> de tu factura de {formatMonth(explained.month)}. El resto es consumo en reposo, iluminación y otros equipos.
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Tarifa"
            description={ELECTRICITY_MODE_LABELS[company.electricityMode]}
            action={
              <FormDialogButton label="Editar tarifa" size="sm" title="Tarifa eléctrica" description="Los cambios se aplican a las impresiones futuras; los costes ya calculados no cambian." action={saveTariffAction.bind(null, slug)}>
                <Field label="Tipo de tarifa" name="electricityMode">
                  <Select defaultValue={company.electricityMode}>
                    <option value="fixed">{ELECTRICITY_MODE_LABELS.fixed}</option>
                    <option value="tou">{ELECTRICITY_MODE_LABELS.tou}</option>
                  </Select>
                </Field>
                <Field label="Precio fijo" name="kwhPrice" required hint="Se usa con «Precio fijo».">
                  <NumberInput unit="€/kWh" defaultValue={numberToInput(company.kwhPrice, 5)} />
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Punta" name="kwhPricePeak" required>
                    <NumberInput defaultValue={numberToInput(company.kwhPricePeak, 5)} />
                  </Field>
                  <Field label="Llano" name="kwhPriceFlat" required>
                    <NumberInput defaultValue={numberToInput(company.kwhPriceFlat, 5)} />
                  </Field>
                  <Field label="Valle" name="kwhPriceValley" required>
                    <NumberInput defaultValue={numberToInput(company.kwhPriceValley, 5)} />
                  </Field>
                </div>
                <p className="text-[0.8125rem] text-fg-3">Precios en €/kWh con impuestos. Periodos del peaje 2.0TD: valle de 0 a 8 h y fines de semana; punta de 10 a 14 h y de 18 a 22 h; llano el resto.</p>
              </FormDialogButton>
            }
          />
          <CardBody>
            {tou ? (
              <TariffToday tariff={tariff} timeZone={tz} />
            ) : (
              <p className="text-sm text-fg-2">
                Pagas <span className="font-mono text-fg tabular">{formatNumber(company.kwhPrice, 4)} €/kWh</span> a cualquier hora. Si tu contrato tiene periodos (punta, llano y valle), cámbialo para calcular el coste real de cada impresión según la hora.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Consumo por máquina" description={formatMonth(month)} />
          <CardBody>
            <BarList
              items={data.perMachine.map((m) => ({ label: m.name ?? "Máquina eliminada", value: m.kwh, hint: `${formatHours(m.seconds)} · ${formatMoney(m.costCents)}`, href: m.machineId ? `/e/${slug}/maquinas/${m.machineId}` : undefined }))}
              format="kwh"
              showShare
              emptyMessage="Sin impresiones este mes"
            />
          </CardBody>
        </Card>
        {tou ? (
          <Card>
            <CardHeader title="Cuándo imprimes" description="Reparto del consumo de impresión por periodo" />
            <CardBody className="flex flex-col gap-4">
              <StackedBar segments={(["valley", "flat", "peak"] as const).map((p) => ({ label: TARIFF_PERIOD_LABELS[p], value: Math.round(data.byPeriod[p] * 100) / 100 }))} format="kwh" />
              {peakShare > 25 ? (
                <Alert tone="neutral" title="Puedes ahorrar moviendo impresiones">
                  El {formatPercent(peakShare)} de tu consumo cae en punta. Programa las impresiones largas de noche o en fin de semana: en valle pagas {formatNumber(company.kwhPriceValley, 3)} €/kWh frente a {formatNumber(company.kwhPricePeak, 3)} € en punta.
                </Alert>
              ) : periodTotal > 0 ? (
                <p className="text-sm text-fg-2">Buen reparto: poca impresión en horas punta.</p>
              ) : null}
            </CardBody>
          </Card>
        ) : (
          <EnergySimulator tariff={tariff} timeZone={tz} machines={machines.filter((m) => m.status !== "retired")} />
        )}
      </div>
      {tou ? <EnergySimulator tariff={tariff} timeZone={tz} machines={machines.filter((m) => m.status !== "retired")} /> : null}

      <DataTable
        caption="Facturas de luz"
        columns={[
          { key: "period", header: "Periodo facturado" },
          { key: "provider", header: "Comercializadora", hideBelow: "md" },
          { key: "kwh", header: "Consumo", numeric: true },
          { key: "price", header: "€/kWh efectivo", numeric: true, hideBelow: "sm" },
          { key: "amount", header: "Importe", numeric: true },
          { key: "actions", header: <span className="sr-only">Acciones</span>, align: "right", className: "w-12 px-1" },
        ]}
        rows={bills.map((b) => ({
          key: b.id,
          cells: [
            <span key="p" className="whitespace-nowrap">{formatDateShort(b.periodStart)} – {formatDateShort(b.periodEnd)}</span>,
            <span key="pr" className="text-fg-2">{b.provider ?? "—"}</span>,
            b.kwh > 0 ? formatKwh(b.kwh) : "—",
            b.kwh > 0 ? `${formatNumber(b.amountCents / 100 / b.kwh, 3)} €` : "—",
            formatMoney(b.amountCents),
            <ActionsMenu
              key="a"
              size="sm"
              label="Acciones de la factura"
              items={[
                { type: "form", label: "Editar", icon: <Pencil />, title: "Editar factura de luz", action: saveEnergyBillAction.bind(null, slug), content: <BillFields bill={b} defaults={prevMonth} /> },
                { type: "confirm", label: "Eliminar", icon: <Trash2 />, danger: true, title: "¿Eliminar esta factura?", description: "También se eliminará su gasto en Finanzas.", action: deleteEnergyBillAction.bind(null, slug, b.id) },
              ]}
            />,
          ],
        }))}
        empty={<EmptyState icon={<Zap />} title="Sin facturas de luz" description="Registra tus facturas para compararlas con el consumo estimado de las máquinas y llevar el gasto real en Finanzas." action={billButton} />}
      />
    </>
  );
}
