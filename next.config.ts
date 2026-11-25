import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Paquetes solo-servidor que no deben empaquetarse (WASM, sockets nativos).
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "mqtt", "ws"],
  // Las migraciones SQL se leen del disco en tiempo de ejecución.
  outputFileTracingIncludes: {
    "/**": ["./drizzle/**/*"],
  },
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
