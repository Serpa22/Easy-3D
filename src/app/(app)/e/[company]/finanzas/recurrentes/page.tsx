import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { Pause, Pencil, Play, Plus, Repeat, Trash2 } from "lucide-react";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import { ActionsMenu, FormDialogButton } from "@/components/ui/actions";
import { Badge, EmptyState, PageHeader, Stat, StatGrid } from "@/components/ui/display";
import { Checkbox, DateInput, Field, Input, MoneyInput, NumberInput, Select } from "@/components/ui/form";
import { DataTable } from "@/components/ui/table";
import { todayISO } from "@/lib/dates";
import { CATEGORY_LABELS, EXPENSE_CATEGORIES, RECURRING_FREQUENCIES, RECURRING_FREQUENCY_LABELS, categoryLabel } from "@/lib/domain";
import { centsToInput, formatDate, formatMoney, numberToInput } from "@/lib/format";
import { deleteRecurringAction, saveRecurringAction, setRecurringActiveAction } from "@/server/actions/recurring";
import { requireCompany } from "@/server/context";
import { recurringExpenses, type RecurringExpense } from "@/server/db/schema";
import { monthlyEquivalentCents, nextChargeDate } from "@/server/domain/recurring";

export const metadata: Metadata = { title: "Gastos recurrentes" };

function Fields({ rec, today, vat }: { rec?: RecurringExpense; today: string; vat: number }) {
  return (
    <>
      {rec ? <input type="hidden" name="id" value={rec.id} /> : null}
      <Field label="Concepto" name="name" required>
        <Input defaultValue={rec?.name} placeholder="Suscripción de diseño 3D" maxLength={120} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Importe (IVA incluido)" name="amount" required>
          <MoneyInput defaultValue={centsToInput(rec?.amountCents)} />
        </Field>
        <Field label="Frecuencia" name="frequency">
          <Select defaultValue={rec?.frequency ?? "monthly"}>
            {RECURRING_FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {RECURRING_FREQUENCY_LABELS[f]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Categoría" name="category">
          <Select defaultValue={rec?.category ?? "software"}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="IVA" name="vatRatePct">
          <NumberInput unit="%" defaultValue={numberToInput(rec?.vatRatePct ?? vat)} />
        </Field>
        <Field label="Primer cargo" name="startDate" required hint="Los siguientes repiten el día.">
          <DateInput defaultValue={rec?.startDate ?? today} />
        </Field>
        <Field label="Último cargo" name="endDate" hint="Opcional.">
          <DateInput defaultValue={rec?.endDate ?? ""} />
        </Field>
      </div>
      <Field label="Proveedor" name="counterparty">
        <Input defaultValue={rec?.counterparty ?? ""} maxLength={120} />
      </Field>
      <Checkbox name="active" defaultChecked={rec?.active ?? true} label="Activo" hint="En pausa no genera cargos nuevos." />
    </>
  );
}

export default async function RecurringPage({ params }: { params: Promise<{ company: string }> }) {
  const { company, db, org } = await requireCompany((await params).company);
  const slug = company.slug;
  const today = todayISO(org.timeZone);
  const rows = await db.select().from(recurringExpenses).where(eq(recurringExpenses.companyId, company.id)).orderBy(asc(recurringExpenses.name));
  const active = rows.filter((r) => r.active);
  const upcoming = active.map((r) => nextChargeDate(r, today)).filter((d): d is string => Boolean(d)).sort()[0];
  const save = saveRecurringAction.bind(null, slug);
  const newButton = (
    <FormDialogButton label="Nuevo gasto recurrente" icon={<Plus />} variant="primary" title="Nuevo gasto recurrente" action={save} submitLabel="Crear">
      <Fields today={today} vat={company.vatRatePct} />
    </FormDialogButton>
  );
  return (
    <>
      <PageHeader title="Finanzas" description="Suscripciones, alquiler, cuotas… Cada cargo se apunta solo en Movimientos el día que toca." actions={newButton} />
      <FinanceTabs slug={slug} current="recurrentes" />
      <StatGrid cols={3} className="grid-cols-1 sm:grid-cols-3">
        <Stat label="Coste mensual equivalente" value={formatMoney(active.reduce((a, r) => a + monthlyEquivalentCents(r), 0))} icon={<Repeat />} />
        <Stat label="Gastos activos" value={active.length} hint={rows.length > active.length ? `${rows.length - active.length} en pausa` : undefined} />
        <Stat label="Próximo cargo" value={upcoming ? formatDate(upcoming) : "—"} />
      </StatGrid>
      <DataTable
        caption="Gastos recurrentes"
        columns={[
          { key: "name", header: "Concepto" },
          { key: "cat", header: "Categoría", hideBelow: "md" },
          { key: "freq", header: "Frecuencia", hideBelow: "sm" },
          { key: "next", header: "Próximo cargo" },
          { key: "last", header: "Último generado", hideBelow: "lg" },
          { key: "amount", header: "Importe", numeric: true },
          { key: "actions", header: <span className="sr-only">Acciones</span>, align: "right", className: "w-12 px-1" },
        ]}
        rows={rows.map((r) => {
          const next = nextChargeDate(r, today);
          return {
            key: r.id,
            cells: [
              <div key="n" className="max-w-64">
                <p className="truncate font-medium">{r.name}</p>
                {r.counterparty ? <p className="truncate text-[0.8125rem] text-fg-3">{r.counterparty}</p> : null}
              </div>,
              <span key="c" className="whitespace-nowrap text-fg-2">{categoryLabel(r.category)}</span>,
              RECURRING_FREQUENCY_LABELS[r.frequency],
              r.active ? next ? <span className="whitespace-nowrap">{formatDate(next)}</span> : <Badge>Finalizado</Badge> : <Badge tone="warn">En pausa</Badge>,
              <span key="l" className="whitespace-nowrap text-fg-2">{r.lastGeneratedDate ? formatDate(r.lastGeneratedDate) : "—"}</span>,
              formatMoney(r.amountCents),
              <ActionsMenu
                key="a"
                size="sm"
                label={`Acciones de ${r.name}`}
                items={[
                  { type: "form", label: "Editar", icon: <Pencil />, title: "Editar gasto recurrente", action: save, content: <Fields rec={r} today={today} vat={company.vatRatePct} /> },
                  { type: "action", label: r.active ? "Pausar" : "Reanudar", icon: r.active ? <Pause /> : <Play />, action: setRecurringActiveAction.bind(null, slug, r.id, !r.active) },
                  { type: "separator" },
                  { type: "confirm", label: "Eliminar", icon: <Trash2 />, danger: true, title: `¿Eliminar «${r.name}»?`, description: "Dejará de generar cargos. Los cargos ya apuntados en Movimientos se conservan.", action: deleteRecurringAction.bind(null, slug, r.id) },
                ]}
              />,
            ],
          };
        })}
        empty={<EmptyState icon={<Repeat />} title="Sin gastos recurrentes" description="Da de alta lo que pagas cada mes, trimestre o año (software, alquiler, hosting, anuncios) y olvídate de apuntarlo a mano." action={newButton} />}
      />
    </>
  );
}
