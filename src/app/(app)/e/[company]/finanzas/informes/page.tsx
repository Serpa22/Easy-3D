import type { Metadata } from "next";
import { Download } from "lucide-react";
import { BarChart } from "@/components/charts/bar-chart";
import { BarList } from "@/components/charts/simple";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardBody, CardHeader, PageHeader, Stat, StatGrid } from "@/components/ui/display";
import { FilterChips, param, type SearchParams } from "@/components/ui/nav";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { monthOf, todayISO } from "@/lib/dates";
import { categoryLabel } from "@/lib/domain";
import { formatMoney, formatMonth, formatMonthShort, formatPercent } from "@/lib/format";
import { requireCompany } from "@/server/context";
import { getYearReport } from "@/server/queries/finance-reports";
import { getMonthlyTotals } from "@/server/queries/finance";

export const metadata: Metadata = { title: "Informes" };

const QUARTERS = [1, 2, 3, 4] as const;

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ company: string }>; searchParams: Promise<SearchParams> }) {
  const { company, db, org } = await requireCompany((await params).company);
  const sp = await searchParams;
  const slug = company.slug;
  const basePath = `/e/${slug}/finanzas/informes`;
  const currentYear = Number(monthOf(todayISO(org.timeZone)).slice(0, 4));
  const rawYear = Number(param(sp, "ano"));
  const year = Number.isInteger(rawYear) && rawYear >= 2000 && rawYear <= currentYear ? rawYear : currentYear;
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const [monthly, report] = await Promise.all([getMonthlyTotals(db, company.id, months), getYearReport(db, company.id, year)]);
  const years = Array.from(new Set([...report.years, currentYear])).sort((a, b) => b - a);
  const total = monthly.reduce((a, m) => ({ income: a.income + m.incomeCents, expense: a.expense + m.expenseCents }), { income: 0, expense: 0 });

  const matrix = (type: "income" | "expense") => {
    const rows = new Map<string, number[]>();
    for (const r of report.byCategory.filter((x) => x.type === type)) {
      const row = rows.get(r.category) ?? [0, 0, 0, 0];
      row[r.quarter - 1] += r.cents;
      rows.set(r.category, row);
    }
    return [...rows.entries()].map(([category, q]) => ({ category, q, total: q.reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total);
  };
  const vatOf = (type: "income" | "expense", q: number) => Math.round(report.vat.find((v) => v.type === type && v.quarter === q)?.vatCents ?? 0);
  const top = (type: "income" | "expense") => report.counterparties.filter((c) => c.type === type).slice(0, 5).map((c) => ({ label: c.counterparty!, value: c.cents }));

  return (
    <>
      <PageHeader
        title="Finanzas"
        description="Cuenta de resultados del año, gastos por categoría e IVA orientativo por trimestre."
        actions={
          <Button href={`/e/${slug}/finanzas/exportar?desde=${year}-01-01&hasta=${year}-12-31`} icon={<Download />} prefetch={false}>
            Exportar CSV de {year}
          </Button>
        }
      />
      <FinanceTabs slug={slug} current="informes" />
      <FilterChips label="Año" items={years.map((y) => ({ href: y === currentYear ? basePath : `${basePath}?ano=${y}`, label: String(y), current: y === year }))} />

      <StatGrid cols={4}>
        <Stat label={`Ingresos ${year}`} value={formatMoney(total.income)} />
        <Stat label={`Gastos ${year}`} value={formatMoney(total.expense)} />
        <Stat label="Beneficio" value={formatMoney(total.income - total.expense)} />
        <Stat label="Margen" value={total.income > 0 ? formatPercent(((total.income - total.expense) / total.income) * 100) : "—"} />
      </StatGrid>

      <Card>
        <CardHeader title="Beneficio por mes" description={`${year} · ingresos menos gastos`} />
        <CardBody>
          <BarChart
            data={monthly.map((m) => ({ label: formatMonthShort(m.month), fullLabel: formatMonth(m.month), values: { profit: m.profitCents } }))}
            series={[{ key: "profit", label: "Beneficio" }]}
            format="money"
            height={220}
            negativeTone="danger"
            negativeLabel="Mes en pérdidas"
            ariaLabel={`Beneficio por mes de ${year}`}
            categoryLabel="Mes"
          />
        </CardBody>
      </Card>

      <Table>
        <caption className="sr-only">Cuenta de resultados por mes</caption>
        <THead>
          <tr>
            <TH>Mes</TH>
            <TH align="right">Ingresos</TH>
            <TH align="right">Gastos</TH>
            <TH align="right">Beneficio</TH>
            <TH align="right" hideBelow="sm">Margen</TH>
          </tr>
        </THead>
        <TBody>
          {monthly.map((m) => (
            <TR key={m.month}>
              <TD className="first-letter:uppercase">{formatMonth(m.month).split(" ")[0]}</TD>
              <TD numeric>{formatMoney(m.incomeCents)}</TD>
              <TD numeric>{formatMoney(m.expenseCents)}</TD>
              <TD numeric className={m.profitCents < 0 ? "text-danger" : ""}>{formatMoney(m.profitCents)}</TD>
              <TD numeric hideBelow="sm">{m.incomeCents > 0 ? formatPercent((m.profitCents / m.incomeCents) * 100) : "—"}</TD>
            </TR>
          ))}
          <TR className="bg-elevated font-medium">
            <TD>Total {year}</TD>
            <TD numeric>{formatMoney(total.income)}</TD>
            <TD numeric>{formatMoney(total.expense)}</TD>
            <TD numeric className={total.income - total.expense < 0 ? "text-danger" : ""}>{formatMoney(total.income - total.expense)}</TD>
            <TD numeric hideBelow="sm">{total.income > 0 ? formatPercent(((total.income - total.expense) / total.income) * 100) : "—"}</TD>
          </TR>
        </TBody>
      </Table>

      {(["expense", "income"] as const).map((type) => {
        const rows = matrix(type);
        if (rows.length === 0) return null;
        const totals = QUARTERS.map((q) => rows.reduce((a, r) => a + r.q[q - 1], 0));
        return (
          <Table key={type}>
            <caption className="sr-only">{type === "expense" ? "Gastos" : "Ingresos"} por categoría y trimestre</caption>
            <THead>
              <tr>
                <TH>{type === "expense" ? "Gastos por categoría" : "Ingresos por categoría"}</TH>
                {QUARTERS.map((q) => (
                  <TH key={q} align="right" hideBelow="sm">T{q}</TH>
                ))}
                <TH align="right">Total</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.category}>
                  <TD>{categoryLabel(r.category)}</TD>
                  {QUARTERS.map((q) => (
                    <TD key={q} numeric hideBelow="sm" className="text-fg-2">{r.q[q - 1] ? formatMoney(r.q[q - 1]) : "—"}</TD>
                  ))}
                  <TD numeric>{formatMoney(r.total)}</TD>
                </TR>
              ))}
              <TR className="bg-elevated font-medium">
                <TD>Total</TD>
                {QUARTERS.map((q) => (
                  <TD key={q} numeric hideBelow="sm">{formatMoney(totals[q - 1])}</TD>
                ))}
                <TD numeric>{formatMoney(totals.reduce((a, b) => a + b, 0))}</TD>
              </TR>
            </TBody>
          </Table>
        );
      })}

      <Card>
        <CardHeader title="IVA por trimestre" description="IVA repercutido en tus ingresos menos IVA soportado en tus gastos." />
        <CardBody className="flex flex-col gap-4">
          <Alert tone="neutral">Estimación orientativa calculada con el tipo de IVA de cada movimiento. No sustituye a tu gestoría ni a tus libros de facturas.</Alert>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {QUARTERS.map((q) => {
              const out = vatOf("income", q);
              const input = vatOf("expense", q);
              return (
                <div key={q} className="rounded-md border border-line p-4">
                  <p className="text-[0.8125rem] text-fg-3">{q}.º trimestre</p>
                  <p className={`mt-1 font-mono text-xl font-medium tabular ${out - input < 0 ? "text-fg-2" : ""}`}>{formatMoney(out - input)}</p>
                  <p className="mt-1 text-xs text-fg-3 tabular">
                    {formatMoney(out)} repercutido
                    <br />
                    {formatMoney(input)} soportado
                  </p>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Principales proveedores" description={`Por gasto en ${year}`} />
          <CardBody>
            <BarList items={top("expense")} format="money" emptyMessage="Sin gastos con proveedor este año" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Principales clientes" description={`Por ingresos en ${year}`} />
          <CardBody>
            <BarList items={top("income")} format="money" emptyMessage="Sin ingresos con cliente este año" />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
