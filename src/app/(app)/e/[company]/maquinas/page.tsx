import type { Metadata } from "next";
import { Printer } from "lucide-react";
import { LiveSummary, MachineGrid, type LiveFilter, type MachineCardData } from "@/components/machines/live";
import { NewMachineButton } from "@/components/machines/machine-form";
import { EmptyState, PageHeader } from "@/components/ui/display";
import { FilterChips, hrefWith, param, type SearchParams } from "@/components/ui/nav";
import { requireCompany } from "@/server/context";
import { listBridges } from "@/server/printers/bridges";
import { listMachines, listMaterialOptions } from "@/server/queries/machines";

export const metadata: Metadata = { title: "Máquinas" };

const FILTERS: Array<{ value: LiveFilter; label: string }> = [
  { value: "todas", label: "Todas" },
  { value: "trabajando", label: "Trabajando" },
  { value: "reposo", label: "En reposo" },
  { value: "offline", label: "Sin conexión" },
  { value: "error", label: "Con error" },
];

export default async function MachinesPage({ params, searchParams }: { params: Promise<{ company: string }>; searchParams: Promise<SearchParams> }) {
  const { company, db, org } = await requireCompany((await params).company);
  const sp = await searchParams;
  const slug = company.slug;
  const basePath = `/e/${slug}/maquinas`;
  const [machines, materials, bridges] = await Promise.all([listMachines(db, company.id), listMaterialOptions(db, company.id), listBridges(db)]);
  const raw = param(sp, "estado");
  const filter = FILTERS.some((f) => f.value === raw) ? (raw as LiveFilter) : "todas";

  const cards: MachineCardData[] = machines
    .filter((m) => m.status !== "retired")
    .map((m) => ({
      id: m.id,
      name: m.name,
      subtitle: [m.brand, m.model].filter(Boolean).join(" · ") || "Impresora 3D",
      status: m.status,
      manual: m.connectionType === "none",
      loadedMaterial: m.loadedMaterialName,
      href: `${basePath}/${m.id}`,
      startHref: `/e/${slug}/impresiones?nueva=1&maquina=${m.id}`,
      finishHrefBase: `/e/${slug}/impresiones?terminar=`,
    }));
  const retired = machines.filter((m) => m.status === "retired");
  const newButton = <NewMachineButton slug={slug} materials={materials} bridges={bridges} />;

  return (
    <>
      <PageHeader title="Máquinas" description="Tu sala de máquinas en directo: qué está imprimiendo cada una, cuáles están en reposo y cualquier aviso." actions={newButton} />
      {machines.length === 0 ? (
        <EmptyState
          icon={<Printer />}
          title="Aún no hay máquinas"
          description="Añade tus impresoras 3D. Si las conectas, verás en directo su estado, la pieza que imprimen y sus eventos; si no, puedes apuntar las impresiones a mano."
          action={newButton}
        />
      ) : (
        <>
          <LiveSummary machineIds={cards.map((c) => c.id)} />
          <FilterChips label="Filtrar por estado" items={FILTERS.map((f) => ({ href: hrefWith(basePath, sp, { estado: f.value === "todas" ? null : f.value }), label: f.label, current: filter === f.value }))} />
          <MachineGrid machines={cards} filter={filter} timeZone={org.timeZone} />
          {retired.length > 0 ? (
            <p className="text-sm text-fg-3">
              Retiradas:{" "}
              {retired.map((m, i) => (
                <span key={m.id}>
                  {i > 0 ? ", " : ""}
                  <a href={`${basePath}/${m.id}`} className="underline underline-offset-4 hover:text-fg">
                    {m.name}
                  </a>
                </span>
              ))}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
