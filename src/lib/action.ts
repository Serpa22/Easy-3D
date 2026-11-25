/**
 * Resultado estándar de una Server Action. Lo consumen `ActionForm` y
 * `useAction` en la interfaz.
 */
export type FieldErrors = Record<string, string>;

export type ActionOk<T = unknown> = { ok: true; data?: T; message?: string };
export type ActionFail = { ok: false; error?: string; fieldErrors?: FieldErrors };
export type ActionResult<T = unknown> = ActionOk<T> | ActionFail;
/** Estado para `useActionState`: `null` antes del primer envío. */
export type ActionState<T = unknown> = ActionResult<T> | null;
