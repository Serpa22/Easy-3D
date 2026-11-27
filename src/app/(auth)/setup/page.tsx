import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, Checkbox, Field, Input, SubmitButton } from "@/components/ui/form";
import { setupAction } from "@/server/actions/auth";
import { hasUsers } from "@/server/auth/users";

export const metadata: Metadata = { title: "Primer arranque" };

export default async function SetupPage() {
  if (await hasUsers()) redirect("/login");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Configura Easy 3D</h1>
      <p className="mt-1.5 text-sm text-fg-2">Crea tu cuenta de propietario y tu primera sub-empresa. Podrás añadir más después.</p>
      <ActionForm action={setupAction} className="mt-8">
        {process.env.E3D_SETUP_TOKEN ? (
          <Field label="Código de instalación" name="setupToken" required hint="El valor de E3D_SETUP_TOKEN que configuraste al desplegar. Evita que otra persona cree la cuenta antes que tú.">
            <Input type="password" autoComplete="off" maxLength={200} />
          </Field>
        ) : null}
        <Field label="Nombre de tu empresa" name="orgName" required hint="La empresa matriz que agrupa a las sub-empresas.">
          <Input defaultValue="Easy 3D" maxLength={80} />
        </Field>
        <Field label="Tu nombre" name="name" required>
          <Input autoComplete="name" maxLength={80} />
        </Field>
        <Field label="Correo electrónico" name="email" required>
          <Input type="email" autoComplete="username" inputMode="email" />
        </Field>
        <Field label="Contraseña" name="password" required hint="Mínimo 8 caracteres.">
          <Input type="password" autoComplete="new-password" minLength={8} />
        </Field>
        <hr className="my-1 border-0 border-t border-line" />
        <Field label="Primera sub-empresa" name="companyName" hint="Por ejemplo «Prokeys». Déjalo vacío para crearla más tarde.">
          <Input placeholder="Prokeys" maxLength={80} />
        </Field>
        <Field label="Actividad" name="companyActivity">
          <Input placeholder="Teclas para teclados mecánicos" maxLength={120} />
        </Field>
        <Checkbox name="demo" label="Cargar datos de ejemplo" hint="Crea dos sub-empresas de demostración con máquinas simuladas, pedidos y finanzas para explorar la app. Se pueden borrar desde Ajustes." />
        <SubmitButton size="lg" block className="mt-2">
          Crear cuenta y entrar
        </SubmitButton>
      </ActionForm>
    </>
  );
}
