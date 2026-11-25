import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Building2, Printer, ShoppingBag, Wallet } from "lucide-react";
import { BarList, Sparkline } from "@/components/charts/simple";
import { pctDelta } from "@/components/dashboard/shared";
import { LiveProvider } from "@/components/live/live-provider";
import { NowPrinting, WorkingCount } from "@/components/machines/live";
import { NewCompanyButton } from "@/components/shell/new-company-dialog";
import { Card, CardBody, CardHeader, EmptyState, Monogram, PageHeader, Stat, StatGrid } from "@/components/ui/display";
import { addMonths, lastMonths, monthOf, todayISO } from "@/lib/dates";
import { formatMoney, formatMonth } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { listCompanies } from "@/server/context";
import { getDb } from "@/server/db";
import { getGroupOverview } from "@/server/queries/dashboard";
import { getLiveSnapshot } from "@/server/queries/live";
import { getOrgSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Vista de grupo" };

export default async function GroupPage() {
  await requireUser();
  const [companies, org, db] = await Promise.all([listCompanies(), getOrgSettings(), getDb()]);
  const today = todayISO(org.timeZone);
  const month = monthOf(today);
  const months = lastMonths(6, month);
  const [stats, snapshot] = await Promise.all([getGroupOverview(db, companies.map((c) => c.id), month, months), getLiveSnapshot(db)]);

  if (companies.length === 0) {
    return (
      <>
        <PageHeader title={org.orgName} description="Vista de grupo" />
        <EmptyState
          icon={<Building2 />}
          title="Crea tu primera sub-empresa"
          description="Cada sub-empresa (teclas, figuras…) lleva por separado sus finanzas, pedidos, envíos, máquinas, materiales y energía. Aquí verás el resumen de todas."
          action={<NewCompanyButton variant="primary">Crear sub-empresa</NewCompanyButton>}
        />
      </>
    );
  }

  const all = companies.map((c) => ({ company: c, s: stats.get(c.id)! }));
  const income = all.reduce((a, x) => a + x.s.incomeCents, 0);
  const expense = all.reduce((a, x) => a + x.s.expenseCents, 0);
  const prevIncome = all.reduce((a, x) => a + (x.s.incomeSeries[months.length - 2] ?? 0), 0);
  const openOrders = all.reduce((a, x) => a + x.s.openOrders, 0);
  const machineList = all.flatMap((x) => x.s.machines.map((m) => ({ ...m, href: `/e/${x.company.slug}/maquinas/${m.id}`, company: x.company.name })));

  return (
    <LiveProvider initial={snapshot}>
      <PageHeader
        title={org.orgName}
        eyebrow={`Vista de grupo · ${formatMonth(month)}`}
        description={`${companies.length} ${companies.length === 1 ? "sub-empresa" : "sub-empresas"}. Entra en cada una para gestionarla por separado.`}
        actions={<NewCompanyButton />}
      />

      <StatGrid cols={5} className="md:grid-cols-3">
        <Stat label="Ingresos del grupo" value={formatMoney(income)} delta={pctDelta(income, prevIncome, true)} hint={`vs ${formatMonth(addMonths(month, -1)).split(" ")[0]}`} icon={<ArrowDownLeft />} />
        <Stat label="Gastos del grupo" value={formatMoney(expense)} icon={<ArrowUpRight />} />
        <Stat label="Beneficio" value={formatMoney(income - expense)} icon={<Wallet />} />
        <Stat label="Pedidos abiertos" value={openOrders} icon={<ShoppingBag />} />
        <Stat label="Máquinas trabajando" value={<WorkingCount />} icon={<Printer />} className="col-span-2 md:col-span-1" />
      </StatGrid>

      <section aria-label="Sub-empresas" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {all.map(({ company, s }) => (
          <Card key={company.id} className="relative flex flex-col p-5 transition-colors hover:border-line-strong hover:bg-elevated">
            <div className="flex items-start gap-3.5">
              <Monogram text={company.monogram ?? company.name} size="lg" inverted />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold">
                  <Link href={`/e/${company.slug}`} className="after:absolute after:inset-0 after:rounded-lg">
                    {company.name}
                  </Link>
                </h2>
                <p className="truncate text-[0.8125rem] text-fg-3">{company.activity ?? "Sub-empresa"}</p>
              </div>
              <Sparkline values={s.incomeSeries} label={`Ingresos de ${company.name} en los últimos 6 meses`} />
            </div>
            <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
              <div>
                <dt className="text-xs text-fg-3">Ingresos</dt>
                <dd className="mt-0.5 font-mono text-sm tabular">{formatMoney(s.incomeCents)}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-3">Gastos</dt>
                <dd className="mt-0.5 font-mono text-sm tabular">{formatMoney(s.expenseCents)}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-3">Beneficio</dt>
                <dd className={`mt-0.5 font-mono text-sm tabular ${s.incomeCents - s.expenseCents < 0 ? "text-danger" : ""}`}>{formatMoney(s.incomeCents - s.expenseCents)}</dd>
              </div>
            </dl>
            <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-fg-2">
              <span className="inline-flex items-center gap-1.5">
                <Printer className="size-3.5 text-fg-3" aria-hidden="true" />
                <span className="tabular">
                  <WorkingCount machineIds={s.machines.map((m) => m.id)} />
                </span>{" "}
                trabajando
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShoppingBag className="size-3.5 text-fg-3" aria-hidden="true" />
                {s.openOrders} {s.openOrders === 1 ? "pedido abierto" : "pedidos abiertos"}
              </span>
              {s.lowStock > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-warn">
                  <AlertTriangle className="size-3.5" aria-hidden="true" />
                  {s.lowStock} con stock bajo
                </span>
              ) : null}
            </p>
          </Card>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Todas las máquinas, ahora" description="Lo que se está imprimiendo en cada sub-empresa, en directo." />
          <CardBody>
            <NowPrinting machines={machineList} timeZone={org.timeZone} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Ingresos por sub-empresa" description={formatMonth(month)} />
          <CardBody>
            <BarList items={all.map((x) => ({ label: x.company.name, value: x.s.incomeCents, href: `/e/${x.company.slug}/finanzas` }))} format="money" showShare emptyMessage="Sin ingresos este mes" />
          </CardBody>
        </Card>
      </div>
    </LiveProvider>
  );
}
