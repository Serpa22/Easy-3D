"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type Tone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(tone: Tone, message: string) {
  const id = nextId++;
  items = [...items.slice(-3), { id, tone, message }];
  emit();
  setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4000);
}
function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** Avisos breves: `toast.success("Guardado")`, `toast.error("…")`, `toast.info("…")`. */
export const toast = {
  success: (message: string) => push("success", message),
  error: (message: string) => push("error", message),
  info: (message: string) => push("info", message),
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const EMPTY: ToastItem[] = [];

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };
const TONES = { success: "text-ok", error: "text-danger", info: "text-fg-2" };

/** Contenedor de avisos. Se monta una vez en el layout raíz. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => EMPTY);
  const ref = useRef<HTMLDivElement>(null);

  // Vive en la capa superior (popover manual) para quedar por encima de los
  // diálogos modales; se vuelve a mostrar con cada aviso para subir al frente.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const canPopover = typeof el.showPopover === "function";
    if (list.length === 0) {
      if (canPopover && el.matches(":popover-open")) el.hidePopover();
      el.removeAttribute("data-open");
      return;
    }
    if (canPopover) {
      if (el.matches(":popover-open")) el.hidePopover();
      el.showPopover();
    } else {
      el.setAttribute("data-open", "");
    }
  }, [list]);

  return (
    <div ref={ref} popover="manual" className="toaster" role="region" aria-label="Avisos">
      <div aria-live="polite" className="contents">
        {list.map((t) => {
          const Icon = ICONS[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className="toast flex w-full max-w-sm items-start gap-3 rounded-md border border-line-strong bg-elevated px-4 py-3 text-sm text-fg shadow-pop"
            >
              <Icon className={`mt-0.5 size-4 shrink-0 ${TONES[t.tone]}`} aria-hidden="true" />
              <p className="min-w-0 flex-1 break-words">{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Cerrar aviso"
                className="-m-1.5 rounded-sm p-1.5 text-fg-3 hover:bg-hover hover:text-fg active:bg-active"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
