import type { Metadata } from "next";
import { asc, isNotNull } from "drizzle-orm";
import { ArrowRight, Cloud, Database, Download, FlaskConical, HardDrive, Plus, Printer, Server, Trash2, UserCog } from "lucide-react";
import { NewBridgeButton } from "@/components/settings/new-bridge";
import { ActionButton, ActionsMenu, FormDialogButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { RelativeTime, ThemeToggle } from "@/components/ui/client-bits";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusDot } from "@/components/ui/display";
import { ConfirmButton } from "@/components/ui/dialog";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { TabsNav, param, type SearchParams } from "@/components/ui/nav";
import { DataTable } from "@/components/ui/table";
import { USER_ROLE_LABELS } from "@/lib/domain";
import { formatDate, formatTime } from "@/lib/format";
import { removeDemoAction, seedDemoAction } from "@/server/actions/demo";
import { createUserAction, deleteBridgeAction, deleteUserAction, restoreCompanyAction, saveOrgAction, setUserRoleAction, updateAccountAction } from "@/server/actions/settings";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { companies, users } from "@/server/db/schema";
import { DEMO_MARKER } from "@/server/demo/seed";
import { listBridges } from "@/server/printers/bridges";
import { embeddedEnabled } from "@/server/printers/embedded";
import { getOrgSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Ajustes generales" };

const TABS = [
  { key: "organizacion", label: "Organización" },
  { key: "usuarios", label: "Usuarios" },
  { key: "conexiones", label: "Conexiones" },
  { key: "datos", label: "Datos" },
] as const;
const ZONES = ["Europe/Madrid", "Atlantic/Canary", "Europe/Lisbon", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Rome", "America/Mexico_City", "America/Bogota", "America/Lima", "America/Santiago", "America/Argentina/Buenos_Aires", "America/New_York", "UTC"];

function Box({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-md border border-line-strong bg-bg px-3 py-3 text-center">
      <span className="text-fg-2 [&>svg]:size-5">{icon}</span>
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-fg-3">{children}</span>
    </div>
  );
}
const Arrow = () => <ArrowRight className="size-4 shrink-0 rotate-90 text-fg-3 sm:rotate-0" aria-hidden="true" />;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const me = await requireUser();
  const owner = me.role === "owner";
  const sp = await searchParams;
  const rawTab = param(sp, "tab");
  const tab = TABS.some((t) => t.key === rawTab) ? (rawTab as (typeof TABS)[number]["key"]) : "organizacion";
  const [db, org] = await Promise.all([getDb(), getOrgSettings()]);

  const header = (
    <>
      <PageHeader title="Ajustes generales" description="Organización, usuarios, conexión con las impresoras y datos. Afectan a todas las sub-empresas." />
      <TabsNav label="Secciones de ajustes" items={TABS.map((t) => ({ href: t.key === "organizacion" ? "/ajustes" : `/ajustes?tab=${t.key}`, label: t.label, current: t.key === tab }))} />
      {!owner ? <Alert tone="neutral">Solo los propietarios pueden cambiar estos ajustes. Puedes consultarlos y gestionar tu propia cuenta.</Alert> : null}
    </>
  );

  if (tab === "usuarios") {
    const list = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt }).from(users).orderBy(asc(users.createdAt));
    return (
      <>
        {header}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Personas con acceso</h2>
          {owner ? (
            <FormDialogButton label="Añadir usuario" icon={<Plus />} variant="primary" title="Añadir usuario" description="Comparte con esa persona el correo y la contraseña inicial; podrá cambiarla en «Mi cuenta»." action={createUserAction} submitLabel="Crear usuario">
              <Field label="Nombre" name="name" required>
                <Input maxLength={80} autoComplete="off" />
              </Field>
              <Field label="Correo electrónico" name="email" required>
                <Input type="email" autoComplete="off" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Contraseña inicial" name="password" required hint="Mínimo 8 caracteres.">
                  <Input type="text" autoComplete="off" minLength={8} className="font-mono" />
                </Field>
                <Field label="Rol" name="role">
                  <Select defaultValue="member">
                    <option value="member">Miembro</option>
                    <option value="owner">Propietario</option>
                  </Select>
                </Field>
              </div>
              <p className="text-[0.8125rem] text-fg-3">Los miembros gestionan todas las sub-empresas; solo los propietarios cambian usuarios, conexiones y ajustes generales.</p>
            </FormDialogButton>
          ) : null}
        </div>
        <DataTable
          caption="Usuarios"
          columns={[
            { key: "name", header: "Nombre" },
            { key: "email", header: "Correo", hideBelow: "sm" },
            { key: "role", header: "Rol" },
            { key: "since", header: "Alta", hideBelow: "md" },
            { key: "actions", header: <span className="sr-only">Acciones</span>, align: "right", className: "w-12 px-1" },
          ]}
          rows={list.map((u) => ({
            key: u.id,
            cells: [
              <span key="n" className="font-medium">
                {u.name}
                {u.id === me.id ? <span className="ml-2 font-normal text-fg-3">(tú)</span> : null}
              </span>,
              <span key="e" className="text-fg-2">{u.email}</span>,
              <Badge key="r" tone={u.role === "owner" ? "solid" : "outline"}>{USER_ROLE_LABELS[u.role]}</Badge>,
              <span key="s" className="whitespace-nowrap text-fg-2">{formatDate(u.createdAt, org.timeZone)}</span>,
              owner && u.id !== me.id ? (
                <ActionsMenu
                  key="a"
                  size="sm"
                  label={`Acciones de ${u.name}`}
                  items={[
                    { type: "action", label: u.role === "owner" ? "Cambiar a miembro" : "Hacer propietario", icon: <UserCog />, action: setUserRoleAction.bind(null, u.id, u.role === "owner" ? "member" : "owner") },
                    { type: "separator" },
                    { type: "confirm", label: "Eliminar", icon: <Trash2 />, danger: true, title: `¿Eliminar a ${u.name}?`, description: "Perderá el acceso de inmediato y se cerrarán sus sesiones.", action: deleteUserAction.bind(null, u.id) },
                  ]}
                />
              ) : null,
            ],
          }))}
        />
        <Card>
          <CardHeader title="Mi cuenta" description={me.email} />
          <CardBody>
            <ActionForm action={updateAccountAction} className="max-w-md">
              <Field label="Nombre" name="name" required>
                <Input defaultValue={me.name} maxLength={80} autoComplete="name" />
              </Field>
              <Field label="Contraseña actual" name="currentPassword" hint="Solo si vas a cambiarla.">
                <Input type="password" autoComplete="current-password" />
              </Field>
              <Field label="Nueva contraseña" name="newPassword" hint="Mínimo 8 caracteres. Cerrará tus otras sesiones.">
                <Input type="password" autoComplete="new-password" minLength={8} />
              </Field>
              <div>
                <SubmitButton>Guardar cuenta</SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      </>
    );
  }

  if (tab === "conexiones") {
    const bridges = await listBridges(db);
    const embedded = embeddedEnabled();
    return (
      <>
        {header}
        <Card>
          <CardHeader title="Cómo se conecta la app a tus impresoras" description="Las impresoras viven en la red de tu taller. Hay dos formas de que la app las vea en directo." />
          <CardBody className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
                App en tu red local {embedded ? <Badge tone="ok">Activo en este servidor</Badge> : <Badge>No disponible aquí</Badge>}
              </p>
              <div className="flex flex-col items-center gap-2 sm:flex-row">
                <Box icon={<HardDrive />} title="Easy 3D">en un PC o mini-PC del taller</Box>
                <Arrow />
                <Box icon={<Printer />} title="Impresoras">misma red wifi o cable</Box>
              </div>
              <p className="mt-3 text-sm text-fg-2">La app se conecta sola. No hay que instalar nada más: basta con elegir el tipo de conexión en cada máquina.</p>
            </div>
            <div>
              <p className="mb-3 text-sm font-semibold">App en la nube</p>
              <div className="flex flex-col items-center gap-2 sm:flex-row">
                <Box icon={<Cloud />} title="Easy 3D">en internet</Box>
                <Arrow />
                <Box icon={<Server />} title="Bridge">programa en tu taller</Box>
                <Arrow />
                <Box icon={<Printer />} title="Impresoras">red del taller</Box>
              </div>
              <p className="mt-3 text-sm text-fg-2">Desde internet no se llega a tu red local, así que un pequeño programa (bridge) en un ordenador o Raspberry Pi del taller lee las impresoras y envía los datos a la app.</p>
            </div>
          </CardBody>
        </Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Bridges</h2>
          {owner ? <NewBridgeButton /> : null}
        </div>
        <DataTable
          caption="Bridges"
          columns={[
            { key: "name", header: "Bridge" },
            { key: "state", header: "Estado" },
            { key: "machines", header: "Máquinas", numeric: true },
            { key: "version", header: "Versión", hideBelow: "sm" },
            { key: "actions", header: <span className="sr-only">Acciones</span>, align: "right", className: "w-12 px-1" },
          ]}
          rows={bridges.map((b) => {
            const alive = b.lastSeenAt !== null && Date.now() - b.lastSeenAt.getTime() < 120_000;
            return {
              key: b.id,
              cells: [
                <span key="n" className="font-medium">{b.name}</span>,
                <span key="s" className="inline-flex items-center gap-2 whitespace-nowrap text-sm">
                  <StatusDot variant={alive ? "pulse" : "dashed"} tone={alive ? "ok" : "neutral"} />
                  {alive ? "Conectado" : b.lastSeenAt ? <>Sin señal desde <RelativeTime value={b.lastSeenAt.toISOString()} /></> : "Aún no se ha conectado"}
                </span>,
                b.machineCount,
                <span key="v" className="font-mono text-fg-2">{b.version ?? "—"}</span>,
                owner ? (
                  <ActionsMenu key="a" size="sm" label={`Acciones de ${b.name}`} items={[{ type: "confirm", label: "Eliminar", icon: <Trash2 />, danger: true, title: `¿Eliminar el bridge «${b.name}»?`, description: "Su token dejará de funcionar y sus máquinas pasarán a conectarse desde este servidor.", action: deleteBridgeAction.bind(null, b.id) }]} />
                ) : null,
              ],
            };
          })}
          empty={<EmptyState icon={<Server />} title="Sin bridges" description="Solo los necesitas si la app está alojada en la nube. Si la ejecutas en un equipo de tu taller, se conecta sola a las impresoras." action={owner ? <NewBridgeButton /> : undefined} />}
        />
      </>
    );
  }

  if (tab === "datos") {
    const demoCompanies = await db.select({ description: companies.description }).from(companies);
    const hasDemo = demoCompanies.some((c) => c.description === DEMO_MARKER);
    return (
      <>
        {header}
        <Card>
          <CardHeader title="Datos de ejemplo" description="Dos sub-empresas de demostración («Teclas» y «Figuras») con máquinas simuladas, pedidos, finanzas e historial para explorar la app." />
          <CardBody className="flex flex-wrap items-center gap-3">
            {owner ? (
              <>
                <ActionButton action={seedDemoAction} icon={<FlaskConical />} variant={hasDemo ? "secondary" : "primary"}>
                  {hasDemo ? "Volver a generar los que falten" : "Cargar datos de ejemplo"}
                </ActionButton>
                {hasDemo ? (
                  <ConfirmButton action={removeDemoAction} title="¿Eliminar los datos de ejemplo?" description="Se borrarán las sub-empresas de demostración con todo su contenido. Tus sub-empresas reales no se tocan." confirmLabel="Eliminar datos de ejemplo" icon={<Trash2 />}>
                    Eliminar datos de ejemplo
                  </ConfirmButton>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-fg-2">Solo un propietario puede cargar o eliminar los datos de ejemplo.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Copia de seguridad" description="Descarga todos los datos de negocio de todas las sub-empresas en un archivo JSON." />
          <CardBody className="flex flex-col gap-3">
            {owner ? (
              <div>
                <Button href="/ajustes/exportar" icon={<Download />} prefetch={false}>
                  Descargar copia (JSON)
                </Button>
              </div>
            ) : null}
            <p className="flex items-start gap-2 text-sm text-fg-2">
              <Database className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden="true" />
              No incluye contraseñas, sesiones ni las claves de acceso de las impresoras. La restauración desde este archivo todavía no está disponible en la app: sirve como copia de consulta y para migraciones manuales.
            </p>
          </CardBody>
        </Card>
      </>
    );
  }

  const archived = await db.select({ id: companies.id, name: companies.name, archivedAt: companies.archivedAt }).from(companies).where(isNotNull(companies.archivedAt)).orderBy(asc(companies.name));
  return (
    <>
      {header}
      <Card>
        <CardHeader title="Organización" description="La empresa matriz que agrupa a las sub-empresas." />
        <CardBody>
          <ActionForm action={saveOrgAction} className="max-w-md">
            <Field label="Nombre" name="orgName" required hint="Se muestra en el menú y en la vista de grupo.">
              <Input defaultValue={org.orgName} maxLength={80} disabled={!owner} />
            </Field>
            <Field label="Zona horaria" name="timeZone" hint={`Ahora son las ${formatTime(new Date(), org.timeZone)} en ${org.timeZone}. Define «hoy», los meses y los periodos de la tarifa de luz.`}>
              <Select defaultValue={org.timeZone} disabled={!owner}>
                {(ZONES.includes(org.timeZone) ? ZONES : [org.timeZone, ...ZONES]).map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </Field>
            {owner ? (
              <div>
                <SubmitButton>Guardar organización</SubmitButton>
              </div>
            ) : null}
          </ActionForm>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Apariencia" description="Tema oscuro o claro. Es una preferencia de este navegador." />
        <CardBody>
          <ThemeToggle showLabel className="border border-control" />
        </CardBody>
      </Card>
      {archived.length > 0 ? (
        <Card>
          <CardHeader title="Sub-empresas archivadas" description="Conservan todos sus datos. Recupéralas para volver a verlas en el menú." />
          <CardBody className="pt-3">
            <ul className="divide-y divide-line">
              {archived.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-fg-3"> · archivada el {formatDate(c.archivedAt, org.timeZone)}</span>
                  </span>
                  {owner ? (
                    <ActionButton size="sm" action={restoreCompanyAction.bind(null, c.id)}>
                      Recuperar
                    </ActionButton>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
