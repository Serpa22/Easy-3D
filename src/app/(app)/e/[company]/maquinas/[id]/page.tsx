import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { z } from "zod";
import { EventsTimeline, MachineLivePanel } from "@/components/machines/live";
import { MachineForm } from "@/components/machines/machine-form";
import { ActionsMenu, FormDialogButton } from "@/components/ui/actions";
import { Badge, Card, CardBody, CardHeader, DescriptionList, EmptyState, PageHeader, Stat, StatGrid } from "@/components/ui/display";
import { ConfirmButton } from "@/components/ui/dialog";
import { DateInput, Field, Input, MoneyInput, Select, Textarea } from "@/components/ui/form";
import { TabsNav, param, type SearchParams } from "@/components/ui/nav";
import { DataTable } from "@/components/ui/table";
import { maskConnectionConfig } from "@/lib/connections";
import { monthOf, startOfDayInZone, todayISO } from "@/lib/dates";
import { CONNECTION_TYPE_LABELS, MACHINE_STATUS_LABELS, MAINTENANCE_TYPES, MAINTENANCE_TYPE_LABELS, PRINT_JOB_STATUS_LABELS, TECHNOLOGY_LABELS } from "@/lib/domain";
import { centsToInput, formatDate, formatDateTime, formatDuration, formatHours, formatKwh, formatMoney, formatPercent } from "@/lib/format";
import { deleteMachineAction, deleteMaintenanceAction, saveMaintenanceAction } from "@/server/actions/machines";
import { requireCompany } from "@/server/context";
import type { MaintenanceLog } from "@/server/db/schema";
import { listBridges } from "@/server/printers/bridges";
import { getMachine, getMachineStats, listMachineEvents, listMachineJobs, listMaintenance, listMaterialOptions } from "@/server/queries/machines";

type Props = { params: Promise<{ company: string; id: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { company: slug, id } = await params;
  const { company, db } = await requireCompany(slug);
  const machine = z.uuid().safeParse(id).success ? await getMachine(db, company.id, id) : null;
  return { title: machine?.name ?? "Máquina" };
}

function MaintenanceFields({ log, today }: { log?: MaintenanceLog; today: string }) {
  return (
    <>
      {log ? <input type="hidden" name="id" value={log.id} /> : null}
      <Field label="Qué se hizo" name="title" required>
        <Input defaultValue={log?.title} placeholder="Cambio de boquilla 0,4 mm" maxLength={120} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Fecha" name="date" required>
          <DateInput defaultValue={log?.date ?? today} />
        </Field>
        <Field label="Tipo" name="type">
          <Select defaultValue={log?.type ?? "preventive"}>
            {MAINTENANCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {MAINTENANCE_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Coste" name="cost" hint="Se apunta como gasto en Finanzas.">
          <MoneyInput defaultValue={centsToInput(log?.costCents || null)} />
        </Field>
        <Field label="Próxima revisión" name="nextDueDate">
          <DateInput defaultValue={log?.nextDueDate ?? ""} />
        </Field>
      </div>
      <Field label="Detalle" name="description">
        <Textarea defaultValue={log?.description ?? ""} rows={2} maxLength={2000} />
      </Field>
    </>
  );
}

export default async function MachinePage({ params, searchParams }: Props) {
  const { company: slugParam, id } = await params;
  const { company, db, org } = await requireCompany(slugParam);
  if (!z.uuid().safeParse(id).success) notFound();
  const machine = await getMachine(db, company.id, id);
  if (!machine) notFound();

  const sp = await searchParams;
  const slug = company.slug;
  const basePath = `/e/${slug}/maquinas/${machine.id}`;
  const rawTab = param(sp, "tab");
  const tab = rawTab === "impresiones" || rawTab === "mantenimiento" || rawTab === "ajustes" ? rawTab : "resumen";
  const today = todayISO(org.timeZone);
  const monthStart = startOfDayInZone(`${monthOf(today)}-01`, org.timeZone);
  const since30d = new Date(Date.now() - 30 * 86_400_000);

  const header = (
    <>
      <PageHeader
        back={{ href: `/e/${slug}/maquinas`, label: "Máquinas" }}
        title={machine.name}
        description={[machine.brand, machine.model, TECHNOLOGY_LABELS[machine.technology]].filter(Boolean).join(" · ")}
        actions={machine.status !== "active" ? <Badge tone={machine.status === "maintenance" ? "warn" : "neutral"}>{MACHINE_STATUS_LABELS[machine.status]}</Badge> : undefined}
      />
      <TabsNav
        label="Secciones de la máquina"
        items={[
          { href: basePath, label: "Resumen", current: tab === "resumen" },
          { href: `${basePath}?tab=impresiones`, label: "Impresiones", current: tab === "impresiones" },
          { href: `${basePath}?tab=mantenimiento`, label: "Mantenimiento", current: tab === "mantenimiento" },
          { href: `${basePath}?tab=ajustes`, label: "Ajustes", current: tab === "ajustes" },
        ]}
      />
    </>
  );

  if (tab === "impresiones") {
    const jobs = await listMachineJobs(db, company.id, machine.id, 10);
    return (
      <>
        {header}
        <DataTable
          caption="Últimas impresiones de la máquina"
          columns={[
            { key: "name", header: "Impresión" },
            { key: "start", header: "Inicio", hideBelow: "sm" },
            { key: "duration", header: "Duración", numeric: true },
            { key: "energy", header: "Energía", numeric: true, hideBelow: "md" },
            { key: "status", header: "Estado" },
          ]}
          rows={jobs.map((j) => ({
            key: j.id,
            cells: [
              <span key="n" className="block max-w-xs truncate font-medium">{j.name}</span>,
              <span key="s" className="whitespace-nowrap text-fg-2">{formatDateTime(j.startedAt, org.timeZone)}</span>,
              j.endedAt ? formatDuration(j.durationSec) : "—",
              j.endedAt ? `${formatKwh(j.energyKwh)} · ${formatMoney(j.energyCostCents)}` : "—",
              <Badge key="b" tone={j.status === "completed" ? "ok" : j.status === "failed" ? "danger" : j.status === "cancelled" ? "neutral" : "solid"}>{PRINT_JOB_STATUS_LABELS[j.status]}</Badge>,
            ],
          }))}
          empty={<EmptyState title="Esta máquina aún no tiene impresiones" description="Aparecerán aquí en cuanto imprima algo, en directo o apuntado a mano." />}
        />
        <p>
          <a href={`/e/${slug}/impresiones?maquina=${machine.id}`} className="text-sm font-medium underline underline-offset-4 hover:text-fg-2">
            Ver todas las impresiones de esta máquina
          </a>
        </p>
      </>
    );
  }

  if (tab === "mantenimiento") {
    const logs = await listMaintenance(db, company.id, machine.id);
    const save = saveMaintenanceAction.bind(null, slug, machine.id);
    const total = logs.reduce((acc, l) => acc + l.costCents, 0);
    const nextDue = logs.map((l) => l.nextDueDate).filter((d): d is string => Boolean(d)).sort()[0];
    const addButton = (
      <FormDialogButton label="Registrar mantenimiento" icon={<Plus />} variant="primary" title="Registrar mantenimiento" action={save}>
        <MaintenanceFields today={today} />
      </FormDialogButton>
    );
    return (
      <>
        {header}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <StatGrid cols={3} className="flex-1 grid-cols-2 sm:grid-cols-3">
            <Stat label="Intervenciones" value={logs.length} />
            <Stat label="Gastado en mantenimiento" value={formatMoney(total)} />
            <Stat
              label="Próxima revisión"
              value={nextDue ? formatDate(nextDue) : "—"}
              hint={nextDue && nextDue < today ? <Badge tone="warn">Vencida</Badge> : undefined}
              className="col-span-2 sm:col-span-1"
            />
          </StatGrid>
          {addButton}
        </div>
        <DataTable
          caption="Historial de mantenimiento"
          columns={[
            { key: "date", header: "Fecha" },
            { key: "title", header: "Intervención" },
            { key: "type", header: "Tipo", hideBelow: "sm" },
            { key: "next", header: "Próxima revisión", hideBelow: "md" },
            { key: "cost", header: "Coste", numeric: true },
            { key: "actions", header: <span className="sr-only">Acciones</span>, align: "right", className: "w-12 px-1" },
          ]}
          rows={logs.map((l) => ({
            key: l.id,
            cells: [
              <span key="d" className="whitespace-nowrap text-fg-2">{formatDate(l.date)}</span>,
              <div key="t" className="max-w-md">
                <p className="font-medium">{l.title}</p>
                {l.description ? <p className="text-[0.8125rem] text-fg-3">{l.description}</p> : null}
              </div>,
              MAINTENANCE_TYPE_LABELS[l.type],
              l.nextDueDate ? (
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  {formatDate(l.nextDueDate)}
                  {l.nextDueDate < today ? <Badge tone="warn">Vencida</Badge> : null}
                </span>
              ) : (
                "—"
              ),
              l.costCents > 0 ? formatMoney(l.costCents) : "—",
              <ActionsMenu
                key="m"
                size="sm"
                label={`Acciones de ${l.title}`}
                items={[
                  { type: "form", label: "Editar", icon: <Pencil />, title: "Editar mantenimiento", action: save, content: <MaintenanceFields log={l} today={today} /> },
                  {
                    type: "confirm",
                    label: "Eliminar",
                    icon: <Trash2 />,
                    danger: true,
                    title: "¿Eliminar este registro?",
                    description: "También se eliminará su gasto asociado en Finanzas.",
                    action: deleteMaintenanceAction.bind(null, slug, l.id),
                  },
                ]}
              />,
            ],
          }))}
          empty={<EmptyState icon={<Wrench />} title="Sin mantenimientos registrados" description="Apunta cambios de boquilla, limpiezas, calibraciones y reparaciones para saber cuánto cuesta mantener la máquina y cuándo toca la próxima revisión." action={addButton} />}
        />
      </>
    );
  }

  if (tab === "ajustes") {
    const [materials, bridges] = await Promise.all([listMaterialOptions(db, company.id), listBridges(db)]);
    return (
      <>
        {header}
        <Card>
          <CardBody>
            <MachineForm
              slug={slug}
              materials={materials}
              bridges={bridges}
              values={{
                id: machine.id,
                name: machine.name,
                brand: machine.brand,
                model: machine.model,
                technology: machine.technology,
                serialNumber: machine.serialNumber,
                location: machine.location,
                status: machine.status,
                notes: machine.notes,
                powerPrintW: machine.powerPrintW,
                powerIdleW: machine.powerIdleW,
                purchasePriceCents: machine.purchasePriceCents,
                purchaseDate: machine.purchaseDate,
                lifespanHours: machine.lifespanHours,
                loadedMaterialId: machine.loadedMaterialId,
                connectionType: machine.connectionType,
                bridgeId: machine.bridgeId,
                // Nunca se envían secretos al navegador: solo la versión enmascarada.
                connection: maskConnectionConfig(machine.connectionType, machine.connectionConfig),
              }}
            />
          </CardBody>
        </Card>
        <Card className="border-danger">
          <CardHeader title="Zona de peligro" description="Al eliminar la máquina se conserva su historial de impresiones y los gastos ya registrados, pero sin referencia a ella." />
          <CardBody>
            <ConfirmButton
              action={deleteMachineAction.bind(null, slug, machine.id)}
              title={`¿Eliminar «${machine.name}»?`}
              description="Se cerrará su conexión y desaparecerá de la sala de máquinas. No se puede deshacer."
              confirmLabel="Eliminar máquina"
              icon={<Trash2 />}
            >
              Eliminar máquina
            </ConfirmButton>
          </CardBody>
        </Card>
      </>
    );
  }

  const [stats, events] = await Promise.all([getMachineStats(db, company.id, machine.id, monthStart, since30d), listMachineEvents(db, company.id, machine.id, 40)]);
  const finished = stats.completed + stats.failed;
  const hourlyCents = machine.purchasePriceCents && machine.lifespanHours > 0 ? machine.purchasePriceCents / machine.lifespanHours : null;
  const amortized = machine.lifespanHours > 0 ? (machine.totalPrintSeconds / 3600 / machine.lifespanHours) * 100 : 0;

  return (
    <>
      {header}
      <MachineLivePanel machineId={machine.id} timeZone={org.timeZone} connectionLabel={CONNECTION_TYPE_LABELS[machine.connectionType]} />
      <StatGrid cols={4}>
        <Stat label="Horas de impresión" value={formatHours(machine.totalPrintSeconds)} hint="Totales" />
        <Stat label="Tasa de éxito" value={finished > 0 ? formatPercent((stats.completed / finished) * 100) : "—"} hint={`${stats.completed} completadas · ${stats.failed} fallidas`} />
        <Stat label="Uso últimos 30 días" value={formatPercent((stats.seconds30d / (30 * 86400)) * 100)} hint={`${formatHours(stats.seconds30d)} imprimiendo`} />
        <Stat label="Energía este mes" value={formatMoney(stats.monthEnergyCents)} hint={formatKwh(stats.monthKwh)} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Eventos en directo" description="Inicios, pausas, fines de impresión, errores y cortes de conexión." />
          <CardBody className="pt-3">
            <EventsTimeline
              initial={events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }))}
              url={`${basePath}/eventos`}
              timeZone={org.timeZone}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Ficha" />
          <CardBody>
            <DescriptionList
              cols={1}
              items={[
                { term: "Conexión", value: CONNECTION_TYPE_LABELS[machine.connectionType] },
                { term: "Material cargado", value: machine.loadedMaterialName ?? "—" },
                { term: "Ubicación", value: machine.location ?? "—" },
                { term: "Potencia", value: `${Math.round(machine.powerPrintW)} W imprimiendo · ${Math.round(machine.powerIdleW)} W en reposo` },
                { term: "Compra", value: machine.purchasePriceCents ? `${formatMoney(machine.purchasePriceCents)}${machine.purchaseDate ? ` · ${formatDate(machine.purchaseDate)}` : ""}` : "—" },
                { term: "Amortización", value: hourlyCents !== null ? `${formatMoney(Math.round(hourlyCents))}/h · ${formatPercent(Math.min(amortized, 100))} de su vida útil` : "—" },
                { term: "Mantenimiento acumulado", value: formatMoney(stats.maintenanceCents) },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
