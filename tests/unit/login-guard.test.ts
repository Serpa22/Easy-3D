import { beforeEach, describe, expect, it } from "vitest";
import { TooManyAttemptsError, delayForFailures, failureCount, isBlocked, recordFailure, resetLoginGuard, resetRateLimit, withAccountThrottle } from "@/server/auth/rate-limit";
import { describeError } from "@/server/log";

beforeEach(() => resetLoginGuard());

describe("freno de intentos de acceso", () => {
  it("solo cuentan los fallos y el tope caduca con la ventana", () => {
    const t0 = 1_000_000;
    expect(isBlocked("ip:1", 3, t0).blocked).toBe(false);
    recordFailure("ip:1", 60_000, t0);
    recordFailure("ip:1", 60_000, t0 + 1000);
    expect(isBlocked("ip:1", 3, t0 + 2000).blocked).toBe(false);
    recordFailure("ip:1", 60_000, t0 + 2000);
    expect(isBlocked("ip:1", 3, t0 + 3000)).toEqual({ blocked: true, retryAfterSec: 57 });
    expect(isBlocked("ip:2", 3, t0 + 3000).blocked).toBe(false);
    expect(isBlocked("ip:1", 3, t0 + 60_001).blocked).toBe(false);
    recordFailure("ip:1", 60_000, t0 + 70_000);
    resetRateLimit("ip:1");
    expect(failureCount("ip:1", t0 + 70_001)).toBe(0);
  });

  it("la espera por cuenta crece con los fallos y tiene tope", () => {
    expect([0, 4, 5, 6, 7, 8, 9, 50].map(delayForFailures)).toEqual([0, 0, 1000, 2000, 4000, 8000, 10_000, 10_000]);
  });

  it("procesa los intentos de una cuenta de uno en uno y no bloquea al dueño", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const order: string[] = [];
    const attempt = (label: string, ok: boolean) =>
      withAccountThrottle(
        "account:owner",
        async () => {
          order.push(`${label}:start`);
          await new Promise((r) => setTimeout(r, 5));
          order.push(`${label}:end`);
          if (!ok) {
            recordFailure("account:owner", 60_000);
            throw new Error("mal");
          }
          return label;
        },
        sleep,
      );

    // Ocho intentos fallidos seguidos de un atacante…
    for (let i = 0; i < 8; i++) await attempt(`x${i}`, false).catch(() => {});
    expect(waits).toEqual([1000, 2000, 4000]); // los 5 primeros sin espera; luego 1, 2 y 4 s
    // …y el dueño, con la contraseña correcta, entra (esperando, pero entra).
    await expect(attempt("dueño", true)).resolves.toBe("dueño");
    expect(waits.at(-1)).toBe(8000);

    // En paralelo no se solapan.
    order.length = 0;
    await Promise.all([attempt("a", true), attempt("b", true), attempt("c", true)]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });

  it("rechaza sin procesar cuando hay demasiados intentos en cola para una cuenta", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = () => withAccountThrottle("account:x", () => gate.then(() => "ok"));
    const pending = [slow(), slow(), slow(), slow()];
    await expect(slow()).rejects.toBeInstanceOf(TooManyAttemptsError);
    // Otra cuenta no se ve afectada.
    await expect(withAccountThrottle("account:y", async () => "ok")).resolves.toBe("ok");
    release();
    expect(await Promise.all(pending)).toEqual(["ok", "ok", "ok", "ok"]);
  });
});

describe("registro de errores", () => {
  it("no escribe los parámetros de una consulta fallida", () => {
    const error = Object.assign(new Error('Failed query: update "machines" set "connection_config" = $1 where "id" = $2\nparams: {"host":"192.168.1.50","accessCode":"CLAVE-SECRETA"},abc'), {
      query: 'update "machines" set "connection_config" = $1 where "id" = $2',
      params: ['{"host":"192.168.1.50","accessCode":"CLAVE-SECRETA"}', "abc"],
      cause: Object.assign(new Error('insert or update on table "machines" violates foreign key constraint "machines_bridge_id_bridges_id_fk"'), { code: "23503", constraint_name: "machines_bridge_id_bridges_id_fk", detail: "Key (bridge_id)=(CLAVE-SECRETA) is not present" }),
    });
    const text = describeError(error);
    expect(text).not.toContain("CLAVE-SECRETA");
    expect(text).not.toContain("192.168.1.50");
    expect(text).toContain("23503");
    expect(text).toContain("machines_bridge_id_bridges_id_fk");
    expect(text).toContain('update "machines"');
    expect(describeError(new TypeError("x no es una función"))).toContain("TypeError: x no es una función");
  });
});
