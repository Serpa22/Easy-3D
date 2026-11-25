"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/client-bits";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/display";
import { ActionForm, Field, FormActions, Input, SubmitButton } from "@/components/ui/form";
import { createBridgeAction } from "@/server/actions/settings";

/** Crea un bridge y muestra su token una única vez, con las instrucciones para arrancarlo. */
export function NewBridgeButton() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "https://tu-app";
  const command = `E3D_URL=${origin} E3D_BRIDGE_TOKEN=${token ?? "…"} npm run bridge`;
  const close = () => {
    setOpen(false);
    setToken(null);
  };
  return (
    <>
      <Button variant="primary" icon={<Plus />} onClick={() => setOpen(true)}>
        Crear bridge
      </Button>
      <Dialog open={open} onClose={close} title={token ? "Bridge creado" : "Crear bridge"} description={token ? undefined : "Un bridge es un pequeño programa que se ejecuta en un ordenador o Raspberry Pi de tu taller."} size="md">
        {token ? (
          <div className="flex flex-col gap-4">
            <Alert tone="warn" title="Copia el token ahora">
              No se volverá a mostrar. Si lo pierdes, elimina el bridge y crea otro.
            </Alert>
            <div>
              <p className="mb-1.5 text-[0.8125rem] font-medium text-fg-2">Token</p>
              <div className="flex items-center gap-2 rounded-md border border-line bg-bg px-3 py-2">
                <code className="min-w-0 flex-1 break-all font-mono text-[0.8125rem]">{token}</code>
                <CopyButton value={token} label="Copiar token" />
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[0.8125rem] font-medium text-fg-2">Para arrancarlo, en la carpeta del proyecto en ese equipo:</p>
              <div className="flex items-start gap-2 rounded-md border border-line bg-bg px-3 py-2">
                <code className="min-w-0 flex-1 break-all font-mono text-[0.8125rem]">{command}</code>
                <CopyButton value={command} label="Copiar comando" />
              </div>
            </div>
            <p className="text-sm text-fg-2">Después asigna cada máquina a este bridge en su pestaña Ajustes («Quién se conecta a la máquina»).</p>
            <FormActions>
              <Button variant="primary" onClick={close}>
                Hecho
              </Button>
            </FormActions>
          </div>
        ) : (
          <ActionForm action={createBridgeAction} successToast={false} onSuccess={(res) => setToken((res.data as { token: string }).token)}>
            <Field label="Nombre" name="name" required hint="Para reconocerlo: «Raspberry del taller», «PC de la oficina»…">
              <Input autoFocus maxLength={80} />
            </Field>
            <FormActions>
              <Button onClick={close}>Cancelar</Button>
              <SubmitButton>Crear bridge</SubmitButton>
            </FormActions>
          </ActionForm>
        )}
      </Dialog>
    </>
  );
}
