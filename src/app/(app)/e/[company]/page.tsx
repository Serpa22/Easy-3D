import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Printer, ShoppingBag, Truck, Wallet } from "lucide-react";
import { BarChart } from "@/components/charts/bar-chart";
import { BarList } from "@/components/charts/simple";
import { AttentionList, Checklist, pctDelta } from "@/components/dashboard/shared";
import { NowPrinting, WorkingCount } from "@/components/machines/live";
import { Badge, Card, CardBody, CardHeader, PageHeader, Stat, StatGrid } from "@/components/ui/display";
import { addMonths, lastMonths, monthOf, monthRange, todayISO } from "@/lib/dates";
import { ORDER_STATUS_LABELS, PRINT_JOB_STATUS_LABELS, categoryLabel } from "@/lib/domain";
import { formatDateShort, formatDuration, formatMoney, formatMonth, formatMonthShort, formatPercent } from "@/lib/format";
import { requireCompany } from "@/server/context";
import { getCompanyOverview } from "@/server/queries/dashboard";
import { getCategoryBreakdown, getMonthlyTotals } from "@/server/queries/finance";

export default async function CompanyDashboard({ params }: { params: Promise<{ company: string }> }) {
  const { company, db, org } = await requireCompany((await params).company);
  const slug = company.slug;
  const base = `/e/${slug}`;
  const today = todayISO(org.timeZone);
  const month = monthOf(today);
  const months = lastMonths(6, month);

  const [overview, monthly, expenses] = await Promise.all([
    getCompanyOverview(db, company.id, slug, today),
    getMonthlyTotals(db, company.id, Array.from(new Set([...months, addMonths(month, -1)]))),
    getCategoryBreakdown(db, company.id, { ...monthRange(month), type: "expense" }),
  ]);
  const byMonth = new Map(monthly.map((m) => [m.month, m]));
  const now = byMonth.get(month)!;
  const prev = byMonth.get(addMonths(month, -1))!;
  const c = overview.counts;
  const isNew = c.machines + c.materials + c.products + c.orders + c.transactions === 0;

  return (
    <>
      <PageHeader title={company.name} description={company.activity ?? "Resumen de la sub-empresa"} eyebrow={`Resumen · ${formatMonth(month)}`} />

      {isNew ? (
        <Card>
          <CardHeader title="Primeros pasos" description="Deja lista la sub-empresa en unos minutos. Puedes hacerlo en cualquier orden." />
          <CardBody className="pt-2">
            <Checklist
              steps={[
                { label: "Añade tu primera máquina", description: "Conéctala para verla en directo o apunta sus impresiones a mano.", href: `${base}/maquinas`, done: c.machines > 0 },
                { label: "Da de alta tus materiales", description: "Filamentos, resinas y embalaje, con su stock y su precio.", href: `${base}/materiales`, done: c.materials > 0 },
                { label: "Crea tus productos", description: "Con su receta sabrás cuánto te cuesta cada pieza y tu margen.", href: `${base}/productos`, done: c.products > 0 },
                { label: "Registra tu primer pedido", description: "Al cobrarlo, el ingreso se apunta solo en Finanzas.", href: `${base}/pedidos`, done: c.orders > 0 },
                { label: "Configura la tarifa de luz", description: "Para calcular el coste eléctrico de cada impresión.", href: `${base}/energia`, done: false },
              ]}
            />
          </CardBody>
        </Card>
      ) : null}

      <StatGrid cols={6} className="md:grid-cols-3">
        <Stat label="Ingresos" value={formatMoney(now.incomeCents)} delta={pctDelta(now.incomeCents, prev.incomeCents, true)} icon={<ArrowDownLeft />} href={`${base}/finanzas?tipo=ingreso`} />
        <Stat label="Gastos" value={formatMoney(now.expenseCents)} delta={pctDelta(now.expenseCents, prev.expenseCents, false)} icon={<ArrowUpRight />} href={`${base}/finanzas?tipo=gasto`} />
        <Stat
          label="Beneficio"
          value={formatMoney(now.profitCents)}
          hint={now.incomeCents > 0 ? `Margen ${formatPercent((now.profitCents / now.incomeCents) * 100)}` : undefined}
          icon={<Wallet />}
          href={`${base}/finanzas`}
        />
        <Stat label="Pedidos abiertos" value={overview.openOrders} hint={overview.unpaidOpenCents > 0 ? `${formatMoney(overview.unpaidOpenCents)} por cobrar` : undefined} icon={<ShoppingBag />} href={`${base}/pedidos`} />
        <Stat label="Envíos en curso" value={overview.activeShipments} icon={<Truck />} href={`${base}/envios`} />
        <Stat label="Máquinas trabajando" value={<WorkingCount machineIds={overview.machines.map((m) => m.id)} />} icon={<Printer />} href={`${base}/maquinas`} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Ahora mismo"
            description="Lo que está imprimiendo cada máquina, en directo."
            action={
              <Link href={`${base}/maquinas`} className="text-[0.8125rem] font-medium text-fg-2 underline-offset-4 hover:text-fg hover:underline">
                Ver máquinas
              </Link>
            }
          />
          <CardBody>
            <NowPrinting machines={overview.machines.map((m) => ({ ...m, href: `${base}/maquinas/${m.id}` }))} timeZone={org.timeZone} emptyHref={`${base}/maquinas`} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Requiere atención" />
          <CardBody className="pt-3">
            <AttentionList items={overview.attention} />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Ingresos y gastos" description="Últimos 6 meses" />
          <CardBody>
            <BarChart
              data={months.map((m) => ({ label: formatMonthShort(m), fullLabel: formatMonth(m), values: { income: byMonth.get(m)?.incomeCents ?? 0, expense: byMonth.get(m)?.expenseCents ?? 0 } }))}
              series={[
                { key: "income", label: "Ingresos" },
                { key: "expense", label: "Gastos" },
              ]}
              format="money"
              height={220}
              ariaLabel="Ingresos y gastos de los últimos 6 meses"
              categoryLabel="Mes"
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Gastos por categoría" description={formatMonth(month)} />
          <CardBody>
            <BarList items={expenses.slice(0, 6).map((e) => ({ label: categoryLabel(e.category), value: e.amountCents, href: `${base}/finanzas?tipo=gasto&cat=${e.category}` }))} format="money" emptyMessage="Sin gastos este mes" />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Últimos pedidos"
            action={
              <Link href={`${base}/pedidos`} className="text-[0.8125rem] font-medium text-fg-2 underline-offset-4 hover:text-fg hover:underline">
                Ver todos
              </Link>
            }
          />
          <CardBody className="pt-2">
            {overview.recentOrders.length === 0 ? (
              <p className="py-4 text-sm text-fg-2">Todavía no hay pedidos.</p>
            ) : (
              <ul className="divide-y divide-line">
                {overview.recentOrders.map((o) => (
                  <li key={o.id} className="relative flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        <Link href={`${base}/pedidos/${o.id}`} className="after:absolute after:inset-0 hover:underline">
                          {o.number}
                        </Link>
                        <span className="font-normal text-fg-2"> · {o.customerName}</span>
                      </p>
                      <p className="text-[0.8125rem] text-fg-3">{formatDateShort(o.orderDate)}</p>
                    </div>
                    <Badge tone={o.status === "delivered" ? "ok" : o.status === "cancelled" || o.status === "returned" ? "neutral" : "outline"}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                    <span className="w-20 shrink-0 text-right font-mono text-sm tabular">{formatMoney(o.totalCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Últimas impresiones"
            action={
              <Link href={`${base}/impresiones`} className="text-[0.8125rem] font-medium text-fg-2 underline-offset-4 hover:text-fg hover:underline">
                Ver todas
              </Link>
            }
          />
          <CardBody className="pt-2">
            {overview.recentJobs.length === 0 ? (
              <p className="py-4 text-sm text-fg-2">Todavía no hay impresiones.</p>
            ) : (
              <ul className="divide-y divide-line">
                {overview.recentJobs.map((j) => (
                  <li key={j.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{j.name}</p>
                      <p className="truncate text-[0.8125rem] text-fg-3">
                        {j.machineName ?? "Sin máquina"} · {formatDateShort(j.startedAt, org.timeZone)}
                        {j.durationSec > 0 ? ` · ${formatDuration(j.durationSec)}` : ""}
                      </p>
                    </div>
                    <Badge tone={j.status === "completed" ? "ok" : j.status === "failed" ? "danger" : j.status === "cancelled" ? "neutral" : "solid"}>{PRINT_JOB_STATUS_LABELS[j.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
