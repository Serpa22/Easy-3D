import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * Tests de extremo a extremo contra el build de producción, con una base de
 * datos embebida limpia en `.data-e2e/` (ejecuta antes `npm run build`).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, locale: "es-ES", timezoneId: "Europe/Madrid", trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `rm -rf .data-e2e && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { E3D_DATA_DIR: ".data-e2e", E3D_SECURE_COOKIES: "false" },
  },
});
