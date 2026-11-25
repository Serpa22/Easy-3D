import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out-expo active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-active",
  secondary: "border border-control bg-transparent text-fg hover:bg-hover active:bg-active",
  ghost: "bg-transparent text-fg-2 hover:bg-hover hover:text-fg active:bg-active",
  danger: "border border-danger bg-transparent text-danger hover:bg-danger-dim active:bg-danger-dim",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[0.8125rem] pointer-coarse:h-11",
  md: "h-10 px-4 text-sm pointer-coarse:h-11",
  lg: "h-11 px-5 text-[0.9375rem]",
};

export function buttonClass(opts: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string } = {}) {
  return cn(base, variants[opts.variant ?? "secondary"], sizes[opts.size ?? "md"], opts.block && "w-full", opts.className);
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cn("size-4 animate-[spin_700ms_linear_infinite]", className)}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Ocupa todo el ancho disponible. */
  block?: boolean;
  /** Muestra un indicador de carga y bloquea el botón. */
  loading?: boolean;
  /** Icono a la izquierda (lucide-react). */
  icon?: ReactNode;
}

export type ButtonProps = CommonProps &
  (({ href: string } & Omit<ComponentProps<typeof Link>, "href">) | ({ href?: undefined } & ComponentProps<"button">));

/** Botón. Con `href` se pinta como enlace de Next con el mismo aspecto. */
export function Button({ variant, size, block, loading, icon, className, children, ...props }: ButtonProps) {
  const classes = buttonClass({ variant, size, block, className });
  const content = (
    <>
      {loading ? <Spinner /> : icon ? <span className="inline-flex shrink-0 [&>svg]:size-4">{icon}</span> : null}
      {children}
    </>
  );
  if (props.href !== undefined) {
    return (
      <Link {...props} className={classes}>
        {content}
      </Link>
    );
  }
  const { type = "button", disabled, ...rest } = props;
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={classes} {...rest}>
      {content}
    </button>
  );
}

export type IconButtonProps = Omit<CommonProps, "icon" | "block"> & { label: string } & (
    | ({ href: string } & Omit<ComponentProps<typeof Link>, "href" | "aria-label">)
    | ({ href?: undefined } & Omit<ComponentProps<"button">, "aria-label">)
  );

/** Botón cuadrado solo con icono. `label` es obligatorio (nombre accesible y título). */
export function IconButton({ label, variant = "ghost", size = "md", loading, className, children, ...props }: IconButtonProps) {
  const square = size === "sm" ? "w-8 px-0 pointer-coarse:w-11" : size === "lg" ? "w-11 px-0" : "w-10 px-0 pointer-coarse:w-11";
  const classes = buttonClass({ variant, size, className: cn(square, "[&>svg]:size-[1.125rem]", className) });
  if (props.href !== undefined) {
    return (
      <Link {...props} aria-label={label} title={label} className={classes}>
        {children}
      </Link>
    );
  }
  const { type = "button", disabled, ...rest } = props;
  return (
    <button type={type} aria-label={label} title={label} disabled={disabled || loading} className={classes} {...rest}>
      {loading ? <Spinner /> : children}
    </button>
  );
}
