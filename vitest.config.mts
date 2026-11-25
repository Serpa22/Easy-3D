import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` lanza fuera de React Server Components; en tests es un módulo vacío.
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { E3D_DB: "memory" },
    pool: "forks",
  },
});
