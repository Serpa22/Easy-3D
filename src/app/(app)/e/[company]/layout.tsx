import type { Metadata } from "next";
import { LiveProvider } from "@/components/live/live-provider";
import { todayISO } from "@/lib/dates";
import { requireCompany } from "@/server/context";
import { generateRecurringCharges } from "@/server/domain/recurring";
import { logError } from "@/server/log";
import { getLiveSnapshot } from "@/server/queries/live";

type Props = { params: Promise<{ company: string }>; children: React.ReactNode };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { company } = await requireCompany((await params).company);
  return { title: { default: company.name, template: `%s · ${company.name} · Easy 3D` } };
}

/** Todo lo que cuelga de una sub-empresa: comprueba acceso y abre el estado en directo. */
export default async function CompanyLayout({ params, children }: Props) {
  const { company, db, org } = await requireCompany((await params).company);
  // Convierte en movimientos los gastos recurrentes ya vencidos (barato si no hay nada pendiente).
  await generateRecurringCharges(db, company.id, todayISO(org.timeZone)).catch((error) => logError("recurrentes", error));
  const snapshot = await getLiveSnapshot(db, { companyId: company.id });
  return (
    <LiveProvider initial={snapshot} company={company.slug}>
      {children}
    </LiveProvider>
  );
}
