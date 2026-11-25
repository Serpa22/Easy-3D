import type { Metadata } from "next";
import { ArrowDownLeft, ArrowUpRight, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { BarChart } from "@/components/charts/bar-chart";
import { BarList } from "@/components/charts/simple";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import { TransactionFields } from "@/components/finance/transaction-fields";
import { ActionsMenu, FormDialogButton } from "@/components/ui/actions";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat, StatGrid } from "@/components/ui/display";
import { SearchInput, SelectFilter } from "@/components/ui/form";
import { FilterBar, FilterChips, MonthNav, Pagination, hrefWith, param, type SearchParams } from "@/components/ui/nav";
import { DataTable } from "@/components/ui/table";
import { isISOMonth, lastMonths, monthOf, monthRange, todayISO, addMonths } from "@/lib/dates";
import { CATEGORY_LABELS, TRANSACTION_CATEGORIES, TRANSACTION_SOURCE_LABELS, categoryLabel, type TransactionType } from "@/lib/domain";
import { formatDateShort, formatMoney, formatMoneySigned, formatMonth, formatMonthShort, formatPercent } from "@/lib/format";
import { deleteTransactionAction, saveTransactionAction } from "@/server/actions/finance";
import { requireCompany } from "@/server/context";
import { getCategoryBreakdown, getMonthlyTotals, listTransactions } from "@/server/queries/finance";

export const metadata: Metadata = { title: "Finanzas" };

type Props = { params: Promise<{ company: string }>; searchParams: Promise<SearchParams> };

/** Variación porcentual entre dos periodos para un KPI. */
function delta(current: number, previous: number, goodWhenUp: boolean) {
  if (previous === 0) return undefined;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const direction = pct > 0.5 ? ("up" as const) : pct < -0.5 ? ("down" as const) : ("flat" as const);
  const sentiment = direction === "flat" ? ("neutral" as const) : (direction === "up") === goodWhenUp ? ("positive" as const) : ("negative" as const);
  return { text: `${pct > 0 ? "+" : ""}${formatPercent(pct)}`, direction, sentiment };
}

export default async function FinancePage({ params, searchParams }: Props) {
  const { company, db, org } = await requireCompany((await params).company);
  const sp = await searchParams;
  const slug = company.slug;
  const basePath = `/e/${slug}/finanzas`;
  const today = todayISO(org.timeZone);
  const currentMonth = monthOf(today);

  const rawMonth = param(sp, "mes");
  const month = isISOMonth(rawMonth) && rawMonth <= currentMonth ? rawMonth : currentMonth;
  const rawType = param(sp, "tipo");
  const type: TransactionType | undefined = rawType === "ingreso" ? "income" : rawType === "gasto" ? "expense" : undefined;
  const rawCategory = param(sp, "cat");
  const category = rawCategory && (TRANSACTION_CATEGORIES as readonly string[]).includes(rawCategory) ? rawCategory : undefined;
  const q = param(sp, "q");
  const page = Number(param(sp, "pag")) || 1;
  const range = monthRange(month);

  const months = lastMonths(12, currentMonth);
  const [list, monthly, expensesByCategory] = await Promise.all([
    listTransactions(db, company.id, { ...range, type, category, q, page }),
    getMonthlyTotals(db, company.id, Array.from(new Set([...months, month, addMonths(month, -1)]))),
    getCategoryBreakdown(db, company.id, { ...range, type: "expense" }),
  ]);
  const byMonth = new Map(monthly.map((m) => [m.month, m]));
  const now = byMonth.get(month)!;
  const prev = byMonth.get(addMonths(month, -1))!;
  const saveAction = saveTransactionAction.bind(null, slug);
  const filtered = Boolean(type || category || q);

  const newButtons = (
    <>
      <FormDialogButton label="Nuevo gasto" icon={<Plus />} title="Nuevo gasto" action={saveAction} submitLabel="Añadir gasto">
        <TransactionFields type="expense" today={today} defaultVat={company.vatRatePct} />
      </FormDialogButton>
      <FormDialogButton label="Nuevo ingreso" icon={<Plus />} variant="primary" title="Nuevo ingreso" action={saveAction} submitLabel="Añadir ingreso">
        <TransactionFields type="income" today={today} defaultVat={company.vatRatePct} />
      </FormDialogButton>
    </>
  );

  return (
    <>
      <PageHeader title="Finanzas" description="Ingresos y gastos de la sub-empresa. Los pedidos cobrados, envíos, compras de material y facturas de luz se apuntan solos." actions={newButtons} />
      <FinanceTabs slug={slug} current="movimientos" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={month} basePath={basePath} searchParams={sp} maxMonth={currentMonth} />
        <p className="text-sm text-fg-3">Comparado con {formatMonth(addMonths(month, -1))}</p>
      </div>

      <StatGrid cols={3} className="grid-cols-1 sm:grid-cols-3">
        <Stat label="Ingresos" value={formatMoney(now.incomeCents)} delta={delta(now.incomeCents, prev.incomeCents, true)} icon={<ArrowDownLeft />} />
        <Stat label="Gastos" value={formatMoney(now.expenseCents)} delta={delta(now.expenseCents, prev.expenseCents, false)} icon={<ArrowUpRight />} />
        <Stat
          label="Beneficio"
          value={formatMoney(now.profitCents)}
          delta={delta(now.profitCents, prev.profitCents, true)}
          hint={now.incomeCents > 0 ? `Margen ${formatPercent((now.profitCents / now.incomeCents) * 100)}` : undefined}
          icon={<Wallet />}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Ingresos y gastos" description="Últimos 12 meses" />
          <CardBody>
            <BarChart
              data={months.map((m) => ({
                label: formatMonthShort(m),
                fullLabel: formatMonth(m),
                values: { income: byMonth.get(m)?.incomeCents ?? 0, expense: byMonth.get(m)?.expenseCents ?? 0 },
              }))}
              series={[
                { key: "income", label: "Ingresos" },
                { key: "expense", label: "Gastos" },
              ]}
              format="money"
              height={240}
              ariaLabel="Ingresos y gastos de los últimos 12 meses"
              categoryLabel="Mes"
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Gastos por categoría" description={formatMonth(month)} />
          <CardBody>
            <BarList
              items={expensesByCategory.map((c) => ({
                label: categoryLabel(c.category),
                value: c.amountCents,
                href: hrefWith(basePath, sp, { cat: c.category, tipo: "gasto", pag: null }),
              }))}
              format="money"
              showShare
              emptyMessage="Sin gastos este mes"
            />
          </CardBody>
        </Card>
      </div>

      <FilterBar>
        <FilterChips
          label="Tipo de movimiento"
          items={[
            { href: hrefWith(basePath, sp, { tipo: null, cat: null, pag: null }), label: "Todos", current: !type },
            { href: hrefWith(basePath, sp, { tipo: "ingreso", cat: null, pag: null }), label: "Ingresos", current: type === "income" },
            { href: hrefWith(basePath, sp, { tipo: "gasto", cat: null, pag: null }), label: "Gastos", current: type === "expense" },
          ]}
        />
        <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row">
          <SelectFilter
            param="cat"
            label="Categoría"
            options={[{ value: "", label: "Todas las categorías" }, ...TRANSACTION_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))]}
          />
          <SearchInput placeholder="Buscar concepto o proveedor…" />
        </div>
      </FilterBar>

      <DataTable
        caption={`Movimientos de ${formatMonth(month)}`}
        columns={[
          { key: "date", header: "Fecha" },
          { key: "description", header: "Concepto" },
          { key: "category", header: "Categoría", hideBelow: "md" },
          { key: "source", header: "Origen", hideBelow: "lg" },
          { key: "amount", header: "Importe", numeric: true },
          { key: "actions", header: <span className="sr-only">Acciones</span>, align: "right", className: "w-12 px-1" },
        ]}
        rows={list.rows.map((t) => {
          const editable = t.sourceType === "manual" || t.sourceType === "recurring";
          return {
            key: t.id,
            cells: [
              <span key="d" className="whitespace-nowrap text-fg-2 tabular">
                {formatDateShort(t.date)}
              </span>,
              <div key="c" className="min-w-40 max-w-md">
                <p className="truncate font-medium">{t.description}</p>
                {t.counterparty ? <p className="truncate text-[0.8125rem] text-fg-3">{t.counterparty}</p> : null}
              </div>,
              <span key="cat" className="whitespace-nowrap text-fg-2">
                {categoryLabel(t.category)}
              </span>,
              t.sourceType === "manual" ? <span key="s" className="text-fg-3">Manual</span> : <Badge key="s" tone="outline">{TRANSACTION_SOURCE_LABELS[t.sourceType]}</Badge>,
              <span key="a" className={t.type === "income" ? "text-fg" : "text-fg-2"}>
                {formatMoneySigned(t.type === "income" ? t.amountCents : -t.amountCents)}
              </span>,
              editable ? (
                <ActionsMenu
                  key="m"
                  label={`Acciones de ${t.description}`}
                  size="sm"
                  items={[
                    {
                      type: "form",
                      label: "Editar",
                      icon: <Pencil />,
                      title: t.type === "income" ? "Editar ingreso" : "Editar gasto",
                      action: saveAction,
                      content: <TransactionFields type={t.type} transaction={t} today={today} defaultVat={company.vatRatePct} />,
                    },
                    {
                      type: "confirm",
                      label: "Eliminar",
                      icon: <Trash2 />,
                      danger: true,
                      title: "¿Eliminar este movimiento?",
                      description: `«${t.description}» por ${formatMoney(t.amountCents)} dejará de contar en las finanzas. No se puede deshacer.`,
                      action: deleteTransactionAction.bind(null, slug, t.id),
                    },
                  ]}
                />
              ) : null,
            ],
          };
        })}
        empty={
          filtered ? (
            <EmptyState title="Sin resultados para estos filtros" description="Prueba con otra categoría, otro texto u otro mes." />
          ) : (
            <EmptyState
              icon={<Wallet />}
              title={`Sin movimientos en ${formatMonth(month)}`}
              description="Apunta aquí cualquier ingreso o gasto. Los que nacen de pedidos, envíos, compras de material o facturas de luz aparecerán solos."
              action={newButtons}
            />
          )
        }
      />
      <Pagination page={list.page} pageCount={list.pageCount} total={list.total} basePath={basePath} searchParams={sp} />
    </>
  );
}
