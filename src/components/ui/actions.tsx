"use client";

/**
 * Acciones genéricas para páginas servidor: botón que abre un formulario en un
 * diálogo, botón que ejecuta una acción y menú de acciones por fila. Reciben
 * Server Actions ya enlazadas (`action.bind(null, slug, id)`) y el contenido
 * del formulario como hijos, así las páginas no necesitan un componente
 * cliente por cada formulario.
 */
import { useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import { ConfirmDialog, Dialog, type DialogProps } from "./dialog";
import { ActionForm, FormActions, SubmitButton, useAction, type FormAction } from "./form";
import { DropdownMenu, MenuItem, MenuSeparator } from "./menu";

export interface FormDialogButtonProps {
  /** Texto del botón. */
  label: ReactNode;
  icon?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Título y descripción del diálogo. */
  title: ReactNode;
  description?: ReactNode;
  dialogSize?: DialogProps["size"];
  /** Server Action de formulario: `(prev, formData) => ActionResult`. */
  action: FormAction;
  submitLabel?: string;
  /** Abre el diálogo al cargar (p. ej. enlaces `?nuevo=1`). */
  defaultOpen?: boolean;
  /** Campos del formulario. */
  children: ReactNode;
}

/** Botón + diálogo + formulario conectado a una Server Action. */
export function FormDialogButton({
  label,
  icon,
  variant = "secondary",
  size,
  className,
  title,
  description,
  dialogSize,
  action,
  submitLabel = "Guardar",
  defaultOpen = false,
  children,
}: FormDialogButtonProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <Button variant={variant} size={size} icon={icon} className={className} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} description={description} size={dialogSize}>
        <ActionForm action={action} onSuccess={() => setOpen(false)}>
          {children}
          <FormActions>
            <Button onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton>{submitLabel}</SubmitButton>
          </FormActions>
        </ActionForm>
      </Dialog>
    </>
  );
}

/** Botón que ejecuta una Server Action enlazada (con carga y aviso). */
export function ActionButton({
  action,
  children,
  icon,
  variant = "secondary",
  size,
  className,
}: {
  action: () => Promise<ActionResult>;
  children: ReactNode;
  icon?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const { run, pending } = useAction(action);
  return (
    <Button variant={variant} size={size} icon={icon} className={className} loading={pending} onClick={() => void run()}>
      {children}
    </Button>
  );
}

export type ActionsMenuItem =
  | { type: "link"; label: string; icon?: ReactNode; href: string }
  | { type: "action"; label: string; icon?: ReactNode; action: () => Promise<ActionResult>; disabled?: boolean }
  | {
      type: "form";
      label: string;
      icon?: ReactNode;
      title: ReactNode;
      description?: ReactNode;
      dialogSize?: DialogProps["size"];
      action: FormAction;
      submitLabel?: string;
      content: ReactNode;
    }
  | {
      type: "confirm";
      label: string;
      icon?: ReactNode;
      danger?: boolean;
      title: ReactNode;
      description?: ReactNode;
      confirmLabel?: string;
      action: () => Promise<ActionResult>;
    }
  | { type: "separator" };

/** Menú «⋯» de acciones de una fila: enlaces, acciones directas, formularios y confirmaciones. */
export function ActionsMenu({ label = "Acciones", items, trigger, variant, size }: { label?: string; items: ActionsMenuItem[]; trigger?: ReactNode; variant?: ButtonVariant; size?: ButtonSize }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => Promise<ActionResult>) | null>(null);
  const runner = useAction(async () => (pendingAction ? pendingAction() : { ok: true as const }), {
    onSuccess: () => setOpenIndex(null),
  });
  const direct = useAction(async (action: () => Promise<ActionResult>) => action());
  const current = openIndex !== null ? items[openIndex] : null;

  return (
    <>
      <DropdownMenu label={label} trigger={trigger} variant={variant} size={size}>
        {items.map((item, index) => {
          if (item.type === "separator") return <MenuSeparator key={index} />;
          if (item.type === "link") {
            return (
              <MenuItem key={index} href={item.href} icon={item.icon}>
                {item.label}
              </MenuItem>
            );
          }
          if (item.type === "action") {
            return (
              <MenuItem key={index} icon={item.icon} disabled={item.disabled || direct.pending} onSelect={() => void direct.run(item.action)}>
                {item.label}
              </MenuItem>
            );
          }
          return (
            <MenuItem
              key={index}
              icon={item.icon}
              danger={item.type === "confirm" && item.danger}
              onSelect={() => {
                if (item.type === "confirm") setPendingAction(() => item.action);
                setOpenIndex(index);
              }}
            >
              {item.label}
            </MenuItem>
          );
        })}
      </DropdownMenu>

      {current?.type === "form" ? (
        <Dialog open onClose={() => setOpenIndex(null)} title={current.title} description={current.description} size={current.dialogSize}>
          <ActionForm action={current.action} onSuccess={() => setOpenIndex(null)}>
            {current.content}
            <FormActions>
              <Button onClick={() => setOpenIndex(null)}>Cancelar</Button>
              <SubmitButton>{current.submitLabel ?? "Guardar"}</SubmitButton>
            </FormActions>
          </ActionForm>
        </Dialog>
      ) : null}
      {current?.type === "confirm" ? (
        <ConfirmDialog
          open
          onClose={() => setOpenIndex(null)}
          title={current.title}
          description={current.description}
          confirmLabel={current.confirmLabel ?? "Eliminar"}
          tone={current.danger ? "danger" : "default"}
          pending={runner.pending}
          onConfirm={() => void runner.run()}
        />
      ) : null}
    </>
  );
}
