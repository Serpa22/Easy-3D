import type { AdapterFactory } from "../types";

/** Adaptador pendiente de implementar. */
export const createAdapter: AdapterFactory = (ctx) => ({
  start() {
    ctx.onTelemetry({ state: "offline", errors: [{ message: "Adaptador pendiente de implementar" }] });
  },
  async stop() {},
});
