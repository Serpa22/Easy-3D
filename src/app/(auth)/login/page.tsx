import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, Field, Input, SubmitButton } from "@/components/ui/form";
import { loginAction } from "@/server/actions/auth";
import { getCurrentUser } from "@/server/auth/session";
import { hasUsers } from "@/server/auth/users";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage() {
  if (!(await hasUsers())) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Inicia sesión</h1>
      <p className="mt-1.5 text-sm text-fg-2">Accede al panel de tu empresa de impresión 3D.</p>
      <ActionForm action={loginAction} className="mt-8">
        <Field label="Correo electrónico" name="email" required>
          <Input type="email" autoComplete="username" autoFocus inputMode="email" />
        </Field>
        <Field label="Contraseña" name="password" required>
          <Input type="password" autoComplete="current-password" />
        </Field>
        <SubmitButton size="lg" block className="mt-2">
          Entrar
        </SubmitButton>
      </ActionForm>
    </>
  );
}
