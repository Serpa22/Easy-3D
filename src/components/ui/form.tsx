"use client";

/**
 * Controles de formulario y envío de Server Actions.
 *
 *   <ActionForm action={saveThing.bind(null, slug)} onSuccess={close}>
 *     <Field label="Nombre" name="name" required><Input /></Field>
 *     <Field label="Importe" name="amount"><MoneyInput /></Field>
 *     <SubmitButton>Guardar</SubmitButton>
 *   </ActionForm>
 *
 * `Field` pasa id, name y errores al control que contiene; `ActionForm`
 * muestra los errores del servidor por campo, conserva lo escrito si la
 * acción falla y lanza el aviso de éxito.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Search, X } from "lucide-react";
import type { ActionResult, ActionState, FieldErrors } from "@/lib/action";
import { cn } from "@/lib/cn";
import { Button, type ButtonProps } from "./button";
import { toast } from "./toast";

/* ------------------------------ Contextos ------------------------------ */

interface FormContextValue {
  pending: boolean;
  fieldErrors: FieldErrors;
}
const FormContext = createContext<FormContextValue>({ pending: false, fieldErrors: {} });

interface FieldContextValue {
  id: string;
  name?: string;
  describedBy?: string;
  invalid: boolean;
  required?: boolean;
}
const FieldContext = createContext<FieldContextValue | null>(null);

/** Props que `Field` inyecta en el control que envuelve. */
function useControlProps<P extends { id?: string; name?: string; required?: boolean; "aria-describedby"?: string }>(props: P) {
  const field = useContext(FieldContext);
  if (!field) return props;
  return {
    ...props,
    id: props.id ?? field.id,
    name: props.name ?? field.name,
    required: props.required ?? field.required,
    "aria-describedby": props["aria-describedby"] ?? field.describedBy,
    "aria-invalid": field.invalid || undefined,
  };
}

/* ------------------------------ Controles ------------------------------ */

const controlClass =
  "control block h-10 w-full min-w-0 rounded-md border border-control bg-bg px-3 text-base text-fg transition-colors duration-150 placeholder:text-fg-3 hover:border-fg-2 disabled:cursor-not-allowed disabled:opacity-50 sm:text-[0.9375rem] pointer-coarse:h-11";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...useControlProps(props)} className={cn(controlClass, className)} />;
}

export function Textarea({ className, rows = 3, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={rows} {...useControlProps(props)} className={cn(controlClass, "h-auto min-h-20 py-2 leading-normal", className)} />;
}

/** Select nativo con estilo (el mejor en móvil). */
export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select {...useControlProps(props)} className={cn(controlClass, className)}>
      {children}
    </select>
  );
}

function Affixed({ suffix, prefix, children }: { suffix?: ReactNode; prefix?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative">
      {prefix ? (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-fg-3 [&>svg]:size-4">{prefix}</span>
      ) : null}
      {children}
      {suffix ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-fg-3">{suffix}</span>
      ) : null}
    </div>
  );
}

/** Importe en euros: acepta «12,50». El servidor lo convierte a céntimos con `zCents()`. */
export function MoneyInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <Affixed suffix="€">
      <Input type="text" inputMode="decimal" autoComplete="off" placeholder="0,00" {...props} className={cn("pr-8 text-right font-mono tabular", className)} />
    </Affixed>
  );
}

/** Número con coma decimal y unidad opcional («g», «W», «min», «%»…). */
export function NumberInput({ unit, className, ...props }: Omit<ComponentProps<"input">, "type"> & { unit?: string }) {
  const input = (
    <Input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      {...props}
      className={cn("text-right font-mono tabular", unit && "pr-[calc(1.25rem+var(--unit-ch)*1ch)]", className)}
      style={{ ...props.style, ["--unit-ch" as string]: unit?.length ?? 0 }}
    />
  );
  return unit ? <Affixed suffix={unit}>{input}</Affixed> : input;
}

/** Fecha nativa ('YYYY-MM-DD') o mes ('YYYY-MM') con `month`. */
export function DateInput({ month, className, ...props }: Omit<ComponentProps<"input">, "type"> & { month?: boolean }) {
  return <Input type={month ? "month" : "date"} {...props} className={cn("font-mono tabular", className)} />;
}

/** Color #RRGGBB con muestra. */
export function ColorInput({ defaultValue, className, ...props }: Omit<ComponentProps<"input">, "type" | "value" | "onChange">) {
  const control = useControlProps(props);
  const [value, setValue] = useState(typeof defaultValue === "string" && defaultValue ? defaultValue : "#808080");
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <input
        type="color"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Elegir color"
        className="size-10 shrink-0 cursor-pointer rounded-md border border-control bg-bg p-1 pointer-coarse:size-11"
      />
      <input
        {...control}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        pattern="#[0-9a-fA-F]{6}"
        maxLength={7}
        className={cn(controlClass, "font-mono uppercase")}
      />
    </div>
  );
}

export function Checkbox({ label, hint, className, ...props }: Omit<ComponentProps<"input">, "type"> & { label: ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={props.id ?? id} className={cn("flex min-h-10 cursor-pointer items-start gap-3 py-2 pointer-coarse:min-h-11", className)}>
      <input type="checkbox" id={id} {...props} className="mt-0.5 size-[1.125rem] shrink-0 rounded-sm" />
      <span className="min-w-0 text-sm">
        <span className="text-fg">{label}</span>
        {hint ? <span className="mt-0.5 block text-fg-3">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Interruptor (checkbox con aspecto de conmutador). */
export function Switch({ label, className, ...props }: Omit<ComponentProps<"input">, "type"> & { label: ReactNode }) {
  return (
    <label className={cn("flex min-h-10 cursor-pointer items-center justify-between gap-4 py-2 pointer-coarse:min-h-11", className)}>
      <span className="text-sm text-fg">{label}</span>
      <span className="relative inline-flex shrink-0">
        <input type="checkbox" role="switch" {...props} className="peer absolute inset-0 size-full cursor-pointer opacity-0" />
        <span className="h-6 w-10 rounded-xl border border-control bg-bg transition-colors duration-150 peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring" />
        <span className="pointer-events-none absolute left-1 top-1 size-4 rounded-xl bg-fg-2 transition-transform duration-150 ease-out-expo peer-checked:translate-x-4 peer-checked:bg-primary-fg" />
      </span>
    </label>
  );
}

export interface SegmentedOption {
  value: string;
  label: ReactNode;
}

/** Control segmentado (grupo de radios). Con `name` participa en el formulario. */
export function Segmented({
  options,
  name,
  defaultValue,
  value,
  onChange,
  label,
  className,
}: {
  options: SegmentedOption[];
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  /** Nombre accesible del grupo. */
  label?: string;
  className?: string;
}) {
  const field = useContext(FieldContext);
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value);
  const current = value ?? inner;
  const groupName = name ?? field?.name;
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={field?.describedBy}
      className={cn("inline-flex w-full rounded-md border border-control bg-bg p-0.5 sm:w-auto", className)}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className="relative flex h-9 flex-1 cursor-pointer items-center justify-center whitespace-nowrap rounded-[7px] px-3 text-sm text-fg-2 transition-colors duration-150 hover:text-fg has-checked:bg-primary has-checked:font-medium has-checked:text-primary-fg has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring pointer-coarse:h-10"
        >
          <input
            type="radio"
            name={groupName}
            value={option.value}
            checked={current === option.value}
            onChange={() => {
              setInner(option.value);
              onChange?.(option.value);
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

/* -------------------------------- Field -------------------------------- */

export interface FieldProps {
  label: ReactNode;
  /** Nombre del campo: se pasa al control y enlaza el error del servidor. */
  name?: string;
  hint?: ReactNode;
  /** Error forzado (si no, se toma del `ActionForm` por `name`). */
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** Etiqueta + control + ayuda + error, con el cableado de accesibilidad. */
export function Field({ label, name, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const form = useContext(FormContext);
  const message = error ?? (name ? form.fieldErrors[name] : undefined);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = message ? `${id}-error` : undefined;
  return (
    <FieldContext.Provider
      value={{ id, name, required, invalid: Boolean(message), describedBy: [errorId, hintId].filter(Boolean).join(" ") || undefined }}
    >
      <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        <label htmlFor={id} className="text-[0.8125rem] font-medium text-fg-2">
          {label}
          {required ? (
            <span className="text-fg-3" aria-hidden="true">
              {" "}
              *
            </span>
          ) : null}
        </label>
        {children}
        {message ? (
          <p id={errorId} className="flex items-start gap-1.5 text-[0.8125rem] text-danger">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {message}
          </p>
        ) : null}
        {hint ? (
          <p id={hintId} className="text-[0.8125rem] text-fg-3">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

/* ------------------------------ ActionForm ------------------------------ */

export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionResult>;

export interface ActionFormProps extends Omit<ComponentProps<"form">, "action" | "onSubmit"> {
  action: FormAction;
  onSuccess?: (result: ActionResult & { ok: true }) => void;
  /** Muestra `result.message` como aviso al guardar (por defecto sí). */
  successToast?: boolean;
  /** Vacía el formulario tras guardar. */
  resetOnSuccess?: boolean;
}

/**
 * Formulario conectado a una Server Action. Se envía con `onSubmit` dentro de
 * una transición (no con `action=`) para que React no reinicie los campos
 * cuando el servidor devuelve errores.
 */
export function ActionForm({ action, onSuccess, successToast = true, resetOnSuccess, className, children, ...props }: ActionFormProps) {
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const result = await action(state, formData);
      if (!result) return; // la acción redirigió
      setState(result);
      if (result.ok) {
        if (successToast && result.message) toast.success(result.message);
        if (resetOnSuccess) form.reset();
        onSuccess?.(result);
      }
    });
  }

  // Tras un error, lleva el foco al primer campo marcado.
  useEffect(() => {
    if (!state || state.ok) return;
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    invalid?.focus();
  }, [state]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const formError = state && !state.ok ? state.error : undefined;

  return (
    <FormContext.Provider value={{ pending, fieldErrors }}>
      <form ref={formRef} onSubmit={onSubmit} className={cn("flex flex-col gap-4", className)} {...props}>
        {formError ? (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-danger bg-danger-dim px-3 py-2.5 text-sm text-fg">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
            <span>{formError}</span>
          </div>
        ) : null}
        {children}
      </form>
    </FormContext.Provider>
  );
}

/** Botón de envío: se bloquea y muestra carga mientras la acción está en curso. */
export function SubmitButton({ children = "Guardar", variant = "primary", ...props }: Omit<ButtonProps, "href" | "type">) {
  const { pending } = useContext(FormContext);
  return (
    <Button {...(props as ComponentProps<"button">)} type="submit" variant={variant} loading={pending}>
      {children}
    </Button>
  );
}

/** Fila de botones al pie de un formulario (Cancelar a la izquierda en móvil, a la derecha en escritorio). */
export function FormActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}>{children}</div>;
}

/* ------------------------------- useAction ------------------------------- */

/**
 * Ejecuta una Server Action de forma imperativa (borrar, cambiar estado, enviar
 * JSON…) con estado pendiente y avisos de éxito/error.
 *
 *   const { run, pending } = useAction(deleteThing);
 *   <Button loading={pending} onClick={() => run(slug, id)}>Eliminar</Button>
 */
export function useAction<A extends unknown[], T = unknown>(
  action: (...args: A) => Promise<ActionResult<T>>,
  options: { onSuccess?: (result: ActionResult<T> & { ok: true }) => void; successToast?: boolean; errorToast?: boolean } = {},
) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult<T> | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const run = useCallback(
    (...args: A) =>
      new Promise<ActionResult<T> | undefined>((resolve) => {
        startTransition(async () => {
          const res = await action(...args);
          if (!res) return resolve(undefined); // redirigió
          setResult(res);
          const opts = optionsRef.current;
          if (res.ok) {
            if (opts.successToast !== false && res.message) toast.success(res.message);
            opts.onSuccess?.(res);
          } else if (opts.errorToast !== false) {
            toast.error(res.error ?? "No se ha podido completar la acción.");
          }
          resolve(res);
        });
      }),
    [action],
  );

  return { run, pending, result };
}

/* --------------------------- Filtros por URL --------------------------- */

/** Actualiza parámetros de búsqueda de la URL conservando el resto (y volviendo a la página 1). */
export function useSetSearchParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const set = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === "") next.delete(key);
        else next.set(key, value);
      }
      next.delete("pag");
      const query = next.toString();
      startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
    },
    [router, pathname, searchParams],
  );
  return { set, pending, searchParams };
}

/** Buscador que escribe en un parámetro de la URL (por defecto `q`) con retardo. */
export function SearchInput({ param = "q", placeholder = "Buscar…", className }: { param?: string; placeholder?: string; className?: string }) {
  const { set, searchParams } = useSetSearchParams();
  const initial = searchParams.get(param) ?? "";
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function update(next: string) {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => set({ [param]: next.trim() }), 300);
  }

  return (
    <div className={cn("relative w-full sm:w-64", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => update(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(controlClass, "px-9")}
      />
      {value ? (
        <button
          type="button"
          onClick={() => update("")}
          aria-label="Borrar búsqueda"
          className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-sm text-fg-3 hover:bg-hover hover:text-fg active:bg-active"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** Select que escribe en un parámetro de la URL. La opción con valor "" quita el filtro. */
export function SelectFilter({
  param,
  label,
  options,
  className,
}: {
  param: string;
  /** Nombre accesible («Categoría», «Canal»…). */
  label: string;
  options: Array<{ value: string; label: string }>;
  className?: string;
}) {
  const { set, searchParams } = useSetSearchParams();
  return (
    <select
      aria-label={label}
      value={searchParams.get(param) ?? ""}
      onChange={(e) => set({ [param]: e.target.value })}
      className={cn(controlClass, "w-full sm:w-auto sm:min-w-40", className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
