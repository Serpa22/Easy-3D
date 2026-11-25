/**
 * Limitador en memoria para el login (suficiente para una instancia; en
 * despliegues serverless es solo un freno parcial).
 */
type Bucket = { count: number; resetAt: number };
const buckets: Map<string, Bucket> = ((globalThis as unknown as { __e3dRate?: Map<string, Bucket> }).__e3dRate ??=
  new Map());

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return { allowed: bucket.count <= limit, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
}

export function resetRateLimit(key: string) {
  buckets.delete(key);
}
