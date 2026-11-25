/**
 * Registro de errores sin datos sensibles.
 *
 * Un error de consulta de Drizzle lleva en su mensaje los parámetros enlazados
 * (`params: …`), y entre ellos pueden ir claves de impresoras, hashes o datos
 * personales. Aquí se registra solo lo útil para diagnosticar: la sentencia y el
 * error del driver (código, restricción), nunca los valores.
 */
import "server-only";

interface DriverError {
  message?: string;
  code?: string;
  constraint?: string;
  constraint_name?: string;
  table?: string;
  table_name?: string;
  detail?: string;
}

/** Texto seguro para el registro a partir de cualquier error. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return typeof error === "string" ? error.slice(0, 300) : "error desconocido";
  const query = (error as { query?: unknown }).query;
  if (typeof query === "string") {
    // DrizzleQueryError: `message` incluye los parámetros → se reconstruye sin ellos.
    const cause = ((error as { cause?: unknown }).cause ?? {}) as DriverError;
    const parts = [
      cause.code ? `código ${cause.code}` : null,
      (cause.constraint ?? cause.constraint_name) ? `restricción ${cause.constraint ?? cause.constraint_name}` : null,
      (cause.table ?? cause.table_name) ? `tabla ${cause.table ?? cause.table_name}` : null,
      // El mensaje del driver describe el fallo sin los valores (el `detail` sí puede llevarlos: se omite).
      typeof cause.message === "string" ? cause.message.split("\n")[0].slice(0, 200) : null,
    ].filter(Boolean);
    return `Consulta fallida (${parts.join(" · ") || "sin detalle"}): ${query.replace(/\s+/g, " ").slice(0, 400)}`;
  }
  const stack = error.stack?.split("\n").slice(1, 6).join("\n") ?? "";
  return `${error.name}: ${error.message.slice(0, 500)}${stack ? `\n${stack}` : ""}`;
}

/** `console.error` con el error ya saneado. */
export function logError(scope: string, error: unknown): void {
  console.error(`[${scope}] ${describeError(error)}`);
}
