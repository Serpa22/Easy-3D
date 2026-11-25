import { AppShell } from "@/components/shell/app-shell";
import { requireUser } from "@/server/auth/session";
import { listCompanies } from "@/server/context";
import { getOrgSettings } from "@/server/settings";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [companies, org] = await Promise.all([listCompanies(), getOrgSettings()]);
  return (
    <AppShell
      orgName={org.orgName}
      user={{ name: user.name, email: user.email }}
      companies={companies.map((c) => ({ slug: c.slug, name: c.name, monogram: c.monogram ?? c.name.slice(0, 2), activity: c.activity }))}
    >
      {children}
    </AppShell>
  );
}
