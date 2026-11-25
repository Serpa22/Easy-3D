/** Componentes de presentación (compatibles con Server Components). */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { AlertCircle, AlertTriangle, ArrowDownRight, ArrowLeft, ArrowUpRight, CheckCircle2, Info, Minus } from "lucide-react";
import { cn } from "@/lib/cn";

/* ------------------------------- Tarjetas ------------------------------- */

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-w-0 rounded-lg border border-line bg-surface", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {description ? <p className="mt-1 text-[0.8125rem] text-fg-3">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-5", className)} {...props} />;
}

/** Sección de página con título, descripción y acción opcionales. */
export function Section({
  title,
  description,
  action,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      {title || action ? (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title ? <h2 className="text-base font-semibold text-fg">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-sm text-fg-3">{description}</p> : null}
          </div>
          {action ? <div className="flex items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/* --------------------------------- KPIs --------------------------------- */

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** Variación respecto al periodo anterior. */
  delta?: {
    /** Texto ya formateado: «+12 %», «−340 €». */
    text: string;
    direction: "up" | "down" | "flat";
    /** Si la variación es buena, mala o neutra (un gasto que sube es «negative»). */
    sentiment?: "positive" | "negative" | "neutral";
  };
  hint?: ReactNode;
  icon?: ReactNode;
  /** Convierte la tarjeta entera en enlace. */
  href?: string;
  className?: string;
}

/** Indicador (KPI) sin gráfico: etiqueta, cifra grande y variación. */
export function Stat({ label, value, delta, hint, icon, href, className }: StatProps) {
  const DeltaIcon = delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : Minus;
  const tone = delta?.sentiment === "positive" ? "text-ok" : delta?.sentiment === "negative" ? "text-danger" : "text-fg-2";
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[0.8125rem] text-fg-2">{label}</span>
        {icon ? <span className="shrink-0 text-fg-3 [&>svg]:size-4">{icon}</span> : null}
      </div>
      <div className="mt-2 truncate font-mono text-2xl font-medium tracking-tight text-fg tabular">{value}</div>
      {delta || hint ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.8125rem]">
          {delta ? (
            <span className={cn("inline-flex items-center gap-0.5 font-medium tabular", tone)}>
              <DeltaIcon className="size-3.5" aria-hidden="true" />
              {delta.text}
            </span>
          ) : null}
          {hint ? <span className="text-fg-3">{hint}</span> : null}
        </div>
      ) : null}
    </>
  );
  const classes = cn("block min-w-0 rounded-lg border border-line bg-surface p-4", className);
  if (href) {
    return (
      <Link href={href} className={cn(classes, "transition-colors hover:border-line-strong hover:bg-elevated active:bg-hover")}>
        {body}
      </Link>
    );
  }
  return <div className={classes}>{body}</div>;
}

/** Rejilla de KPIs: 2 columnas en móvil, hasta `cols` en escritorio. */
export function StatGrid({ cols = 4, className, children }: { cols?: 2 | 3 | 4 | 5 | 6; className?: string; children: ReactNode }) {
  const lg = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" }[cols];
  const md = cols >= 5 ? "md:grid-cols-3" : cols === 4 ? "md:grid-cols-4" : "";
  return <div className={cn("grid grid-cols-2 gap-3", md, lg, className)}>{children}</div>;
}

/* ------------------------------- Etiquetas ------------------------------- */

export type Tone = "neutral" | "outline" | "solid" | "ok" | "warn" | "danger";

const BADGE_TONES: Record<Tone, string> = {
  neutral: "bg-hover text-fg-2",
  outline: "border border-line-strong text-fg-2",
  solid: "bg-primary text-primary-fg",
  ok: "bg-ok-dim text-ok",
  warn: "bg-warn-dim text-warn",
  danger: "bg-danger-dim text-danger",
};

export function Badge({ tone = "neutral", icon, className, children }: { tone?: Tone; icon?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-[1.375rem] max-w-full items-center gap-1 whitespace-nowrap rounded-sm px-1.5 text-xs font-medium [&>svg]:size-3 [&>svg]:shrink-0",
        BADGE_TONES[tone],
        className,
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

export type DotVariant = "solid" | "pulse" | "ring" | "dashed";

/**
 * Punto de estado, distinguible también sin color: sólido, con pulso (en
 * directo), hueco (en reposo) o discontinuo (sin conexión). Úsalo siempre
 * junto a un texto.
 */
export function StatusDot({ variant = "solid", tone = "neutral", className }: { variant?: DotVariant; tone?: "neutral" | "ok" | "warn" | "danger"; className?: string }) {
  const color = { neutral: "text-fg", ok: "text-ok", warn: "text-warn", danger: "text-danger" }[tone];
  return (
    <span aria-hidden="true" className={cn("relative inline-flex size-2.5 shrink-0 items-center justify-center", color, className)}>
      {variant === "pulse" ? <span className="absolute inset-0 rounded-xl bg-current animate-[status-pulse_1.6s_ease-out_infinite]" /> : null}
      <span
        className={cn(
          "relative size-2 rounded-xl",
          variant === "solid" || variant === "pulse" ? "bg-current" : "border-[1.5px] border-current",
          variant === "dashed" && "border-dashed opacity-70",
        )}
      />
    </span>
  );
}

/* --------------------------- Estados y avisos --------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong px-6 py-12 text-center", className)}>
      {icon ? <div className="mb-4 flex size-11 items-center justify-center rounded-md border border-line bg-surface text-fg-2 [&>svg]:size-5">{icon}</div> : null}
      <h3 className="text-[0.9375rem] font-semibold text-fg">{title}</h3>
      {description ? <p className="mt-1.5 max-w-md text-sm text-fg-2">{description}</p> : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

const ALERT = {
  neutral: { icon: Info, box: "border-line-strong bg-surface", ink: "text-fg-2" },
  ok: { icon: CheckCircle2, box: "border-ok bg-ok-dim", ink: "text-ok" },
  warn: { icon: AlertTriangle, box: "border-warn bg-warn-dim", ink: "text-warn" },
  danger: { icon: AlertCircle, box: "border-danger bg-danger-dim", ink: "text-danger" },
};

export function Alert({
  tone = "neutral",
  title,
  action,
  className,
  children,
}: {
  tone?: keyof typeof ALERT;
  title?: ReactNode;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const { icon: Icon, box, ink } = ALERT[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-md border px-4 py-3 text-sm", box, className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", ink)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium text-fg">{title}</p> : null}
        {children ? <div className={cn("text-fg-2", title && "mt-0.5")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ---------------------------- Cabecera de página ---------------------------- */

export function PageHeader({
  title,
  description,
  back,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Enlace «volver» encima del título. */
  back?: { href: string; label: string };
  actions?: ReactNode;
  /** Texto pequeño sobre el título (sección, número…). */
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="-ml-1 mb-2 inline-flex min-h-8 items-center gap-1 rounded-sm px-1 text-[0.8125rem] text-fg-2 hover:text-fg active:text-fg-3">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {back.label}
          </Link>
        ) : null}
        {eyebrow ? <div className="mb-1 text-[0.8125rem] text-fg-3">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-fg-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/* ------------------------------ Varios ------------------------------ */

/** Marca cuadrada de 1–3 letras de una sub-empresa. */
export function Monogram({ text, size = "md", inverted, className }: { text: string; size?: "sm" | "md" | "lg"; inverted?: boolean; className?: string }) {
  const dims = { sm: "size-7 text-[0.6875rem] rounded-sm", md: "size-9 text-xs rounded-md", lg: "size-12 text-base rounded-md" }[size];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center font-mono font-semibold tracking-tight",
        inverted ? "bg-primary text-primary-fg" : "border border-line-strong bg-elevated text-fg",
        dims,
        className,
      )}
    >
      {text.slice(0, 3).toUpperCase()}
    </span>
  );
}

/** Barra de progreso. `value` 0..100; sin valor es indeterminada. */
export function Progress({ value, label, tone = "neutral", className }: { value?: number | null; label?: string; tone?: "neutral" | "ok" | "warn" | "danger"; className?: string }) {
  const pct = value === null || value === undefined ? null : Math.min(100, Math.max(0, value));
  const fill = { neutral: "bg-fg", ok: "bg-ok", warn: "bg-warn", danger: "bg-danger" }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct === null ? undefined : Math.round(pct)}
      className={cn("h-1.5 w-full overflow-hidden rounded-xl bg-active", className)}
    >
      {pct === null ? (
        <div className={cn("h-full w-2/5 rounded-xl animate-[progress-indeterminate_1.4s_ease-in-out_infinite]", fill)} />
      ) : (
        <div className={cn("h-full rounded-xl transition-[width] duration-500 ease-out-expo", fill)} style={{ width: `${pct}%` }} />
      )}
    </div>
  );
}

/** Anillo de progreso con el valor en el centro (progreso de impresión). */
export function ProgressRing({ value, size = 72, stroke = 6, label, className, children }: { value: number; size?: number; stroke?: number; label?: string; className?: string; children?: ReactNode }) {
  const pct = Math.min(100, Math.max(0, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${Math.round(pct)} %`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--active)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--text)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          className="transition-[stroke-dashoffset] duration-700 ease-out-expo"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-mono text-sm font-medium tabular">{children ?? `${Math.round(pct)}%`}</div>
    </div>
  );
}

/** Lista de pares término/valor (fichas de detalle). */
export function DescriptionList({ items, cols = 2, className }: { items: Array<{ term: ReactNode; value: ReactNode }>; cols?: 1 | 2 | 3; className?: string }) {
  const grid = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3" }[cols];
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-4", grid, className)}>
      {items.map((item, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[0.8125rem] text-fg-3">{item.term}</dt>
          <dd className="mt-0.5 break-words text-sm text-fg">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-hover", className)} />;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-line", className)} />;
}
