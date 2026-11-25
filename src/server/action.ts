/**
 * Envoltorio común para Server Actions: valida, captura errores y devuelve
 * siempre un `ActionResult` serializable.
 *
 *   export async function saveThing(slug: string, _prev: ActionState, formData: FormData) {
 *     return runAction(async () => {
 *       const { company, db } = await requireCompany(slug);
 *       const input = parseForm(thingSchema, formData);
 *       …
 *       revalidatePath(`/e/${slug}/things`);
 *       return { message: "Guardado" };
 *     });
 *   }
 */
import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import type { ActionResult, FieldErrors } from "@/lib/action";
import { logError } from "@/server/log";

/** Error de negocio con mensaje para el usuario. */
export class ActionError extends Error {
  fieldErrors?: FieldErrors;
  constructor(message: string, fieldErrors?: FieldErrors) {
    super(message);
    this.name = "ActionError";
    this.fieldErrors = fieldErrors;
  }
}

function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export async function runAction<T = undefined>(
  fn: () => Promise<{ data?: T; message?: string } | void>,
): Promise<ActionResult<T>> {
  try {
    const result = await fn();
    return { ok: true, data: result?.data, message: result?.message };
  } catch (error) {
    // redirect() / notFound() se implementan con excepciones: hay que dejarlas pasar.
    unstable_rethrow(error);
    if (error instanceof z.ZodError) {
      const fieldErrors = zodFieldErrors(error);
      return { ok: false, error: fieldErrors._form ?? "Revisa los campos marcados.", fieldErrors };
    }
    if (error instanceof ActionError) {
      return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    }
    // Nunca el error en bruto: una consulta fallida arrastra sus parámetros (claves, datos personales).
    logError("action", error);
    return { ok: false, error: "Ha ocurrido un error inesperado. Inténtalo de nuevo." };
  }
}

/**
 * FormData → objeto plano. Las claves repetidas o terminadas en `[]` se
 * convierten en arrays. Los ficheros se ignoran.
 */
export function formToObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith("$ACTION")) continue; // campos internos de React
    const values = formData.getAll(key).filter((v): v is string => typeof v === "string");
    if (key.endsWith("[]")) out[key.slice(0, -2)] = values;
    else out[key] = values.length > 1 ? values : values[0];
  }
  return out;
}

/** Valida un FormData contra un esquema zod (lanza ZodError → lo recoge `runAction`). */
export function parseForm<S extends z.ZodType>(schema: S, formData: FormData): z.output<S> {
  return schema.parse(formToObject(formData));
}

/** Valida un objeto ya tipado (acciones llamadas directamente con JSON). */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  return schema.parse(input);
}
