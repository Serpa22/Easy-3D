import type { Metadata } from "next";
import Link from "next/link";
import { CheckSquare, ClipboardList, Layers, Pencil, Play, Trash2 } from "lucide-react";
import { z } from "zod";
import { BarChart } from "@/components/charts/bar-chart";
import { EditFields, FinishFields, LogFields, StartFields, type PrintOptions } from "@/components/prints/print-fields";
import { ActionsMenu, FormDialogButton, type ActionsMenuItem } from "@/components/ui/actions";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat, StatGrid } from "@/components/ui/display";
import { SearchInput, SelectFilter } from "@/components/ui/form";
import { FilterBar, MonthNav, Pagination, param, type SearchParams } from "@/components/ui/nav";
import { DataTable } from "@/components/ui/table";
import { addMonths, isISOMonth, monthOf, monthRange, startOfDayInZone, toLocalDateTimeInput, todayISO } from "@/lib/dates";
import { PRINT_JOB_STATUS_LABELS } from "@/lib/domain";
import { formatDateTime, formatDuration, formatHours, formatKwh, formatMoney, formatMonth, formatPercent, formatQty } from "@/lib/format";
import { deletePrintAction, editPrintAction, finishPrintAction, logPrintAction, startPrintAction } from "@/server/actions/prints";
import { requireCompany } from "@/server/context";
import { listMachineOptions, listMaterialOptions } from "@/server/queries/machines";
import { listOrderOptions, listProductOptions } from "@/server/queries/orders";
import { getDailyPrints, getPrintKpis, listPrintJobs } from "@/server/queries/prints";

export const metadata: Metadata = { title: "Impresiones" };

const STATUS = ["en-curso", "completada", "fallida", "cancelada"] as const;

export default async function PrintsPage({ params, searchParams }: { params: Promise<{ company: string }>; searchParams: Promise<SearchParams> }) {
  const { company, db, org } = await requireCompany((await params).company);
  const sp = await searchParams;
  const slug = company.slug;
  const basePath = `/e/${slug}/impresiones`;
  const tz = org.timeZone;
  const today = todayISO(tz);
  const currentMonth = monthOf(today);
  const rawMonth = param(sp, "mes");
  const month = isISOMonth(rawMonth) && rawMonth <= currentMonth ? rawMonth : currentMonth;
  const from = startOfDayInZone(monthRange(month).from, tz);
  const to = startOfDayInZone(`${addMonths(month, 1)}-01`, tz);
  const rawStatus = param(sp, "estado");
  const status = (STATUS as readonly string[]).includes(rawStatus ?? "") ? (rawStatus as (typeof STATUS)[number]) : undefined;
  const rawMachine = param(sp, "maquina");
  const machineId = z.uuid().safeParse(rawMachine).success ? rawMachine : undefined;
  const rawSource = param(sp, "origen");
  const source = rawSource === "live" || rawSource === "manual" ? rawSource : undefined;
  const q = param(sp, "q");

  const [list, kpis, daily, machines, materials, products, orders] = await Promise.all([
    listPrintJobs(db, company.id, { from, to, status, machineId, source, q, page: Number(param(sp, "pag")) || 1 }),
    getPrintKpis(db, company.id, from, to),
    getDailyPrints(db, company.id, from, to, tz),
    listMachineOptions(db, company.id),
    listMaterialOptions(db, company.id),
    listProductOptions(db, company.id),
    listOrderOptions(db, company.id, 40),
  ]);
  const options: PrintOptions = {
    machines: machines.filter((m) => m.status !== "retired").map((m) => ({ id: m.id, name: m.name, manual: m.connectionType === "none", loadedMaterialId: m.loadedMaterialId })),
    materials: materials.filter((m) => m.unit !== "ud").map((m) => ({ id: m.id, name: m.name, unit: m.unit })),
    products: products.map((p) => ({ id: p.id, name: p.name })),
    orders: orders.filter((o) => o.status === "pending" || o.status === "in_production" || o.status === "ready").map((o) => ({ id: o.id, number: o.number, customerName: o.customerName })),
  };
  const now = toLocalDateTimeInput(new Date(), tz);
  const finished = kpis.completed + kpis.failed;
  const wantsNew = param(sp, "nueva") === "1";
  const finishId = param(sp, "terminar");
  const finishRow = z.uuid().safeParse(finishId).success ? list.rows.find((r) => r.job.id === finishId && !r.job.endedAt) : undefined;
  const hasMachines = options.machines.length > 0;

  const buttons = hasMachines ? (
    <>
      <FormDialogButton label="Apuntar impresión terminada" icon={<ClipboardList />} title="Apuntar impresión terminada" description="Para impresiones que no se registraron en directo." dialogSize="lg" action={logPrintAction.bind(null, slug)} submitLabel="Apuntar">
        <LogFields options={options} now={now} machineId={machineId} />
      </FormDialogButton>
      <FormDialogButton label="Iniciar impresión" icon={<Play />} variant="primary" title="Iniciar impresión" description="La máquina aparecerá imprimiendo hasta que la termines." dialogSize="lg" action={startPrintAction.bind(null, slug)} submitLabel="Empezar ahora" defaultOpen={wantsNew}>
        <StartFields options={options} machineId={machineId} />
      </FormDialogButton>
    </>
  ) : null;

  const days = monthRange(month);
  const dayCount = Number(days.to.slice(8));
  const byDay = new Map(daily.map((d) => [d.day, d]));

  return (
    <>
      <PageHeader title="Impresiones" description="Todo lo que sale de tus máquinas: lo detectado en directo y lo apuntado a mano, con su material, energía y coste." actions={buttons} />
      {finishRow ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm">
            <span className="font-medium">{finishRow.job.name}</span> <span className="text-fg-2">sigue en curso en {finishRow.machineName ?? "una máquina"}.</span>
          </p>
          <FormDialogButton label="Terminar impresión" icon={<CheckSquare />} variant="primary" title={`Terminar «${finishRow.job.name}»`} dialogSize="lg" action={finishPrintAction.bind(null, slug)} submitLabel="Terminar" defaultOpen>
            <FinishFields job={finishRow.job} unit={finishRow.materialUnit ?? "g"} now={now} />
          </FormDialogButton>
        </Card>
      ) : null}

      <MonthNav month={month} basePath={basePath} searchParams={sp} maxMonth={currentMonth} />
      <StatGrid cols={6} className="md:grid-cols-3">
        <Stat label="En curso ahora" value={kpis.open} icon={<Layers />} />
        <Stat label="Completadas" value={kpis.completed} hint={kpis.failed > 0 ? `${kpis.failed} fallidas` : "Sin fallos"} />
        <Stat label="Tasa de éxito" value={finished > 0 ? formatPercent((kpis.completed / finished) * 100) : "—"} />
        <Stat label="Horas de impresión" value={formatHours(kpis.seconds)} />
        <Stat label="Material consumido" value={kpis.material.filter((m) => m.qty > 0 && m.unit !== "ud").map((m) => formatQty(m.qty, m.unit)).join(" · ") || "—"} />
        <Stat label="Coste de energía" value={formatMoney(kpis.energyCents)} hint={formatKwh(kpis.energyKwh)} />
      </StatGrid>

      <Card>
        <CardHeader title="Impresiones por día" description={formatMonth(month)} />
        <CardBody>
          <BarChart
            data={Array.from({ length: dayCount }, (_, i) => {
              const day = `${month}-${String(i + 1).padStart(2, "0")}`;
              return { label: String(i + 1), fullLabel: `${i + 1} de ${formatMonth(month)}`, values: { completed: byDay.get(day)?.completed ?? 0, failed: byDay.get(day)?.failed ?? 0 } };
            })}
            series={[
              { key: "completed", label: "Completadas" },
              { key: "failed", label: "Fallidas o canceladas" },
            ]}
            mode="stacked"
            format="count"
            height={200}
            ariaLabel={`Impresiones por día de ${formatMonth(month)}`}
            categoryLabel="Día"
          />
        </CardBody>
      </Card>

      <FilterBar>
        <SearchInput placeholder="Buscar impresión o archivo…" />
        <SelectFilter param="estado" label="Estado" options={[{ value: "", label: "Todos los estados" }, { value: "en-curso", label: "En curso" }, { value: "completada", label: "Completadas" }, { value: "fallida", label: "Fallidas" }, { value: "cancelada", label: "Canceladas" }]} />
        <SelectFilter param="maquina" label="Máquina" options={[{ value: "", label: "Todas las máquinas" }, ...machines.map((m) => ({ value: m.id, label: m.name }))]} />
        <SelectFilter param="origen" label="Origen" options={[{ value: "", label: "Cualquier origen" }, { value: "live", label: "En directo" }, { value: "manual", label: "Manual" }]} />
      </FilterBar>

      <DataTable
        caption="Impresiones"
        columns={[
          { key: "name", header: "Impresión" },
          { key: "machine", header: "Máquina", hideBelow: "md" },
          { key: "start", header: "Inicio", hideBelow: "sm" },
          { key: "duration", header: "Duración", numeric: true },
          { key: "material", header: "Material", numeric: true, hideBelow: "lg" },
          { key: "pieces", header: "Piezas", numeric: true, hideBelow: "lg" },
          { key: "cost", header: "Coste", numeric: true, hideBelow: "md" },
          { key: "status", header: "Estado" },
          { key: "actions", header: <span className="sr-only">Acciones</span>, align: "right", className: "w-12 px-1" },
        ]}
        rows={list.rows.map(({ job: j, machineName, machinePriceCents, machineLifespan, materialName, materialUnit, productName, orderNumber }) => {
          const open = !j.endedAt;
          const depreciation = machinePriceCents && machineLifespan ? Math.round((machinePriceCents / machineLifespan) * (j.durationSec / 3600)) : 0;
          const total = j.materialCostCents + j.energyCostCents + depreciation;
          const items: ActionsMenuItem[] = [];
          if (open) {
            items.push({
              type: "form",
              label: j.source === "live" ? "Cerrar manualmente" : "Terminar",
              icon: <CheckSquare />,
              title: `Terminar «${j.name}»`,
              description: j.source === "live" ? "Esta impresión la sigue la conexión con la máquina y normalmente se cierra sola. Ciérrala a mano solo si se quedó colgada." : undefined,
              dialogSize: "lg",
              action: finishPrintAction.bind(null, slug),
              submitLabel: "Terminar",
              content: <FinishFields job={j} unit={materialUnit ?? "g"} now={now} />,
            });
          } else {
            items.push({ type: "form", label: "Editar", icon: <Pencil />, title: "Editar impresión", description: "Al guardar se recalculan el consumo de material, las piezas en stock y el coste.", dialogSize: "lg", action: editPrintAction.bind(null, slug), content: <EditFields job={j} unit={materialUnit ?? "g"} options={options} current={{ materialName, productName, orderNumber }} /> });
          }
          items.push({ type: "separator" });
          items.push({ type: "confirm", label: "Eliminar", icon: <Trash2 />, danger: true, title: `¿Eliminar «${j.name}»?`, description: "Se devolverán al stock el material consumido y se restarán las piezas y las horas de máquina que sumó.", action: deletePrintAction.bind(null, slug, j.id) });
          return {
            key: j.id,
            cells: [
              <div key="n" className="max-w-64">
                <p className="truncate font-medium">{j.name}</p>
                <p className="truncate text-[0.8125rem] text-fg-3">
                  {[productName, orderNumber ? `Pedido ${orderNumber}` : null, j.source === "live" ? "En directo" : "Manual"].filter(Boolean).join(" · ")}
                </p>
                {j.status === "failed" && j.errorMessage ? <p className="truncate text-[0.8125rem] text-danger">{j.errorMessage}</p> : null}
              </div>,
              j.machineId && machineName ? (
                <Link key="m" href={`/e/${slug}/maquinas/${j.machineId}`} className="whitespace-nowrap underline-offset-4 hover:underline">
                  {machineName}
                </Link>
              ) : (
                "—"
              ),
              <span key="s" className="whitespace-nowrap text-fg-2">{formatDateTime(j.startedAt, tz)}</span>,
              open ? <span key="d" className="text-fg-3">{Math.round(j.progress)} %</span> : formatDuration(j.durationSec),
              j.materialUsed > 0 && materialUnit ? <span key="mt" title={materialName ?? undefined}>{formatQty(j.materialUsed, materialUnit)}</span> : "—",
              open ? "—" : `${j.piecesProduced}${j.piecesFailed > 0 ? ` (+${j.piecesFailed} mal)` : ""}`,
              open ? "—" : <span key="c" title={`Material ${formatMoney(j.materialCostCents)} · Energía ${formatMoney(j.energyCostCents)} (${formatKwh(j.energyKwh)}) · Máquina ${formatMoney(depreciation)}`}>{formatMoney(total)}</span>,
              <Badge key="st" tone={j.status === "completed" ? "ok" : j.status === "failed" ? "danger" : j.status === "cancelled" ? "neutral" : j.status === "paused" ? "warn" : "solid"}>{PRINT_JOB_STATUS_LABELS[j.status]}</Badge>,
              <ActionsMenu key="a" size="sm" label={`Acciones de ${j.name}`} items={items} />,
            ],
          };
        })}
        empty={
          status || machineId || source || q ? (
            <EmptyState title="Sin resultados para estos filtros" />
          ) : (
            <EmptyState
              icon={<Layers />}
              title={`Sin impresiones en ${formatMonth(month)}`}
              description={hasMachines ? "Las máquinas conectadas apuntan aquí sus impresiones solas. Para el resto, inicia una impresión o apunta una ya terminada." : "Añade primero una máquina para poder registrar impresiones."}
              action={buttons ?? undefined}
            />
          )
        }
      />
      <Pagination page={list.page} pageCount={list.pageCount} total={list.total} basePath={basePath} searchParams={sp} />
    </>
  );
}
