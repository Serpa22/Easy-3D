/**
 * Freno a los intentos de acceso, en memoria.
 *
 * Solo cuentan los intentos FALLIDOS. Hay dos mecanismos:
 *
 *  - `isBlocked` / `recordFailure`: tope duro por clave (p. ej. por dirección IP).
 *    Solo debe usarse con claves que el cliente no pueda falsear.
 *  - `withAccountThrottle`: por cuenta. No bloquea la cuenta (bloquearla dejaría
 *    que cualquiera que conozca el correo impidiera entrar a su dueño): los
 *    intentos se procesan de uno en uno y, tras varios fallos, cada uno espera
 *    cada vez más. Adivinar contraseñas se vuelve lentísimo y el dueño, con la
 *    contraseña correcta, entra igualmente.
 *
 * Al vivir en memoria vale para una instancia; en despliegues serverless con
 * varias instancias es un freno parcial.
 */
type Bucket = { count: number; resetAt: number };
type Queue = { tail: Promise<void>; waiting: number };

interface State {
  buckets: Map<string, Bucket>;
  queues: Map<string, Queue>;
}
const state: State = ((globalThis as unknown as { __e3dLoginGuard?: State }).__e3dLoginGuard ??= { buckets: new Map(), queues: new Map() });

const MAX_KEYS = 5000;
/** Intentos en espera por cuenta; a partir de aquí se rechazan sin procesar. */
const MAX_WAITING = 4;
/** Fallos «gratis» antes de empezar a esperar, y espera máxima. */
const FREE_FAILURES = 5;
const MAX_DELAY_MS = 10_000;

function live(key: string, now: number): Bucket | undefined {
  const bucket = state.buckets.get(key);
  if (bucket && bucket.resetAt <= now) {
    state.buckets.delete(key);
    return undefined;
  }
  return bucket;
}

function prune(now: number) {
  if (state.buckets.size <= MAX_KEYS) return;
  for (const [key, bucket] of state.buckets) if (bucket.resetAt <= now) state.buckets.delete(key);
  // Si aun así hay demasiadas (alguien probando miles de claves), se descartan las más antiguas.
  for (const key of state.buckets.keys()) {
    if (state.buckets.size <= MAX_KEYS) break;
    state.buckets.delete(key);
  }
}

/** ¿Ha superado esta clave el tope de fallos? No cuenta nada. */
export function isBlocked(key: string, limit: number, now = Date.now()): { blocked: boolean; retryAfterSec: number } {
  const bucket = live(key, now);
  if (!bucket || bucket.count < limit) return { blocked: false, retryAfterSec: 0 };
  return { blocked: true, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
}

/** Apunta un intento fallido. Devuelve cuántos lleva en la ventana. */
export function recordFailure(key: string, windowMs: number, now = Date.now()): number {
  let bucket = live(key, now);
  if (!bucket) {
    bucket = { count: 0, resetAt: now + windowMs };
    state.buckets.set(key, bucket);
    prune(now);
  }
  bucket.count += 1;
  return bucket.count;
}

export function failureCount(key: string, now = Date.now()): number {
  return live(key, now)?.count ?? 0;
}

export function resetRateLimit(key: string) {
  state.buckets.delete(key);
}

/** Espera antes de comprobar la contraseña según los fallos recientes de la cuenta. */
export function delayForFailures(failures: number): number {
  if (failures < FREE_FAILURES) return 0;
  return Math.min(MAX_DELAY_MS, 1000 * 2 ** Math.min(failures - FREE_FAILURES, 10));
}

export class TooManyAttemptsError extends Error {}

/**
 * Ejecuta `fn` para una cuenta de uno en uno, con la espera que toque.
 * Lanza `TooManyAttemptsError` si ya hay demasiados intentos en cola para ella.
 */
export async function withAccountThrottle<T>(key: string, fn: () => Promise<T>, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  const queue = state.queues.get(key) ?? { tail: Promise.resolve(), waiting: 0 };
  if (queue.waiting >= MAX_WAITING) throw new TooManyAttemptsError();
  queue.waiting += 1;
  state.queues.set(key, queue);
  const run = queue.tail.then(async () => {
    const delay = delayForFailures(failureCount(key));
    if (delay > 0) await sleep(delay);
    return fn();
  });
  queue.tail = run.then(
    () => {},
    () => {},
  );
  try {
    return await run;
  } finally {
    queue.waiting -= 1;
    if (queue.waiting === 0) state.queues.delete(key);
  }
}

/** Solo para tests. */
export function resetLoginGuard() {
  state.buckets.clear();
  state.queues.clear();
}
