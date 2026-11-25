"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { ActionResult } from "@/lib/action";
import { cn } from "@/lib/cn";
import { Button, type ButtonProps, type ButtonVariant } from "./button";
import { useAction } from "./form";
import { closeModalAnimated } from "./top-layer";

const WIDTHS = { sm: "26rem", md: "34rem", lg: "46rem", xl: "60rem" };

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  size?: keyof typeof WIDTHS;
  /** Pie fijo (botones). Si el diálogo contiene un formulario, pon los botones dentro del formulario. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Diálogo modal sobre el `<dialog>` nativo: foco atrapado y devuelto, Esc,
 * clic fuera para cerrar y animación de entrada/salida. En móvil es una hoja
 * inferior con el contenido desplazable. El contenido solo existe mientras
 * está abierto, así que los formularios empiezan limpios cada vez.
 */
export function Dialog({ open, onClose, title, description, size = "md", footer, children, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(open);
  const titleId = useId();
  const descId = useId();

  // Al abrir se monta el contenido (ajuste de estado durante el render, sin efecto).
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      return;
    }
    if (!dialog.open) return;
    let cancelled = false;
    void closeModalAnimated(dialog).then(() => {
      if (!cancelled) setMounted(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, mounted]);

  if (!mounted) return null;

  return (
    <dialog
      ref={ref}
      className={cn("dialog", className)}
      style={{ ["--dialog-width" as string]: WIDTHS[size] }}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onMouseDown={(event) => {
        // Clic en el fondo (el propio <dialog>) = cerrar.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold text-fg">
            {title}
          </h2>
          {description ? (
            <p id={descId} className="mt-1 text-sm text-fg-2">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="-m-2 flex size-10 shrink-0 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg active:bg-active pointer-coarse:size-11"
        >
          <X className="size-[1.125rem]" aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
      {footer ? (
        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
          {footer}
        </footer>
      ) : null}
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  pending?: boolean;
  onConfirm: () => void;
}

/** Confirmación para acciones destructivas o irreversibles. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "danger",
  pending,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} loading={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-fg-2">{description}</div>
    </Dialog>
  );
}

export interface ConfirmButtonProps {
  /** Server Action ya enlazada: `deleteThing.bind(null, slug, id)`. */
  action: () => Promise<ActionResult>;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "default";
  onDone?: () => void;
  variant?: ButtonVariant;
  size?: ButtonProps["size"];
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Botón que pide confirmación y luego ejecuta una Server Action (p. ej. «Eliminar»). */
export function ConfirmButton({
  action,
  title,
  description,
  confirmLabel = "Eliminar",
  tone = "danger",
  onDone,
  variant = "danger",
  size,
  icon,
  className,
  children,
}: ConfirmButtonProps) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction(action, {
    onSuccess: () => {
      setOpen(false);
      onDone?.();
    },
  });
  return (
    <>
      <Button variant={variant} size={size} icon={icon} className={className} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        tone={tone}
        pending={pending}
        onConfirm={() => void run()}
      />
    </>
  );
}
