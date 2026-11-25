"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./button";
import { placeFloating } from "./top-layer";

const MenuContext = createContext<{ close: () => void }>({ close: () => {} });

export interface DropdownMenuProps {
  /** Contenido del botón que abre el menú. Sin él: icono «⋯». */
  trigger?: ReactNode;
  /** Nombre accesible del botón. */
  label: string;
  align?: "start" | "end";
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Clases del botón disparador. */
  triggerClassName?: string;
  children: ReactNode;
}

/**
 * Menú desplegable sobre la API Popover: se cierra con Esc o al pulsar fuera,
 * sigue a su botón al desplazar la página sin salirse de la ventana y se
 * recorre con las flechas.
 */
export function DropdownMenu({ trigger, label, align = "end", variant = "ghost", size = "md", triggerClassName, children }: DropdownMenuProps) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isOpen = () => {
    const menu = menuRef.current;
    if (!menu) return false;
    return typeof menu.showPopover === "function" ? menu.matches(":popover-open") : menu.hasAttribute("data-open");
  };
  const place = () => {
    if (menuRef.current && buttonRef.current) placeFloating(menuRef.current, buttonRef.current, { side: "bottom", align });
  };
  const close = () => {
    const menu = menuRef.current;
    if (!menu || !isOpen()) return;
    if (typeof menu.hidePopover === "function") menu.hidePopover();
    else menu.removeAttribute("data-open");
  };

  useEffect(() => {
    const menu = menuRef.current;
    const button = buttonRef.current;
    if (!menu || !button) return;
    const supported = typeof menu.showPopover === "function";

    const onToggle = (event: Event) => {
      const opened = (event as ToggleEvent).newState === "open";
      button.setAttribute("aria-expanded", String(opened));
      if (opened) {
        place();
        menu.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
      }
    };
    // Al desplazar o redimensionar, el menú sigue a su botón (no se cierra).
    const onReflow = () => {
      if (isOpen()) place();
    };
    menu.addEventListener("toggle", onToggle);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, { capture: true, passive: true });

    // Navegadores sin API Popover: abrir/cerrar a mano.
    let onClick: (() => void) | undefined;
    let onDocDown: ((e: MouseEvent) => void) | undefined;
    if (!supported) {
      menu.removeAttribute("popover");
      onClick = () => {
        if (isOpen()) return close();
        menu.setAttribute("data-open", "");
        button.setAttribute("aria-expanded", "true");
        place();
      };
      onDocDown = (e) => {
        if (isOpen() && !menu.contains(e.target as Node) && !button.contains(e.target as Node)) close();
      };
      button.addEventListener("click", onClick);
      document.addEventListener("mousedown", onDocDown);
    }
    return () => {
      menu.removeEventListener("toggle", onToggle);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, { capture: true });
      if (onClick) button.removeEventListener("click", onClick);
      if (onDocDown) document.removeEventListener("mousedown", onDocDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [align]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'));
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Tab") close();
    if (next !== null) {
      event.preventDefault();
      items[next].focus();
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        popoverTarget={id}
        aria-haspopup="menu"
        aria-expanded="false"
        aria-label={trigger ? undefined : label}
        title={trigger ? undefined : label}
        className={cn(
          buttonClass({ variant, size }),
          !trigger && (size === "sm" ? "w-8 px-0 pointer-coarse:w-11" : "w-10 px-0 pointer-coarse:w-11"),
          triggerClassName,
        )}
      >
        {trigger ?? <MoreHorizontal className="size-[1.125rem]" aria-hidden="true" />}
      </button>
      <div ref={menuRef} id={id} popover="auto" role="menu" aria-label={label} className="menu" onKeyDown={onKeyDown}>
        <MenuContext.Provider value={{ close }}>{children}</MenuContext.Provider>
      </div>
    </>
  );
}

const itemClass =
  "flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-sm text-fg transition-colors hover:bg-hover focus-visible:bg-hover active:bg-active aria-disabled:pointer-events-none aria-disabled:opacity-50 pointer-coarse:min-h-11 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-fg-2";

export interface MenuItemProps {
  /** Enlace interno; si no, se usa `onSelect`. */
  href?: string;
  onSelect?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

export function MenuItem({ href, onSelect, icon, danger, disabled, children }: MenuItemProps) {
  const { close } = useContext(MenuContext);
  const className = cn(itemClass, danger && "text-danger [&>svg]:text-danger");
  if (href && !disabled) {
    return (
      <Link href={href} role="menuitem" className={className} onClick={close}>
        {icon}
        <span className="min-w-0 flex-1 truncate">{children}</span>
      </Link>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      aria-disabled={disabled || undefined}
      className={className}
      onClick={() => {
        if (disabled) return;
        close();
        onSelect?.();
      }}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pb-1 pt-2 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-3">{children}</div>;
}
