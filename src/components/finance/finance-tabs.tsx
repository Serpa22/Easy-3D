import { TabsNav } from "@/components/ui/nav";

/** Pestañas de la sección de finanzas. */
export function FinanceTabs({ slug, current }: { slug: string; current: "movimientos" | "recurrentes" | "informes" }) {
  const base = `/e/${slug}/finanzas`;
  return (
    <TabsNav
      label="Secciones de finanzas"
      items={[
        { href: base, label: "Movimientos", current: current === "movimientos" },
        { href: `${base}/recurrentes`, label: "Recurrentes", current: current === "recurrentes" },
        { href: `${base}/informes`, label: "Informes", current: current === "informes" },
      ]}
    />
  );
}
