"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, Input, SubmitButton, Textarea } from "@/components/ui/form";
import { createCompanyAction } from "@/server/actions/companies";

/** Formulario de alta de una sub-empresa (al crearla se entra en ella). */
export function NewCompanyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nueva sub-empresa"
      description="Cada sub-empresa lleva sus propias finanzas, pedidos, máquinas y materiales."
    >
      <ActionForm action={createCompanyAction}>
        <Field label="Nombre" name="name" required>
          <Input placeholder="Teclas" autoFocus maxLength={80} />
        </Field>
        <Field label="Actividad" name="activity" hint="A qué se dedica. Aparece junto al nombre.">
          <Input placeholder="Teclas artesanales para teclados mecánicos" maxLength={120} />
        </Field>
        <Field label="Descripción" name="description">
          <Textarea rows={2} maxLength={500} />
        </Field>
        <FormActions>
          <Button onClick={onClose}>Cancelar</Button>
          <SubmitButton>Crear sub-empresa</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

/** Botón que abre el alta de sub-empresa. */
export function NewCompanyButton({ children = "Nueva sub-empresa", ...props }: Omit<ButtonProps, "href" | "onClick"> & { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon={<Plus />} {...(props as object)} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <NewCompanyDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
