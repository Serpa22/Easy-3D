/**
 * Capturas de la app para la vista previa (galería que se publica como artefacto).
 *
 *   npm run build
 *   node scripts/vista-previa.mjs <carpeta-de-salida>
 *
 * Arranca el build de producción con una base de datos limpia y los datos de
 * ejemplo, emite una factura, un presupuesto y un albarán, y captura las
 * pantallas principales en JPEG (escritorio y móvil).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const out = path.resolve(process.argv[2] || "vista-previa");
const PORT = 3410;
const B = `http://localhost:${PORT}`;

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${B}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("El servidor no arrancó");
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "e3d-vista-"));
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, E3D_DATA_DIR: data, E3D_SECURE_COOKIES: "false" },
    stdio: "ignore",
    detached: true,
  });
  const shots = [];
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "es-ES", timezoneId: "Europe/Madrid" });
    const page = await ctx.newPage();
    const shot = async (file, title, group) => {
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 82, fullPage: true, caret: "initial" });
      shots.push({ file, title, group });
    };
    const docId = () => page.url().match(/documentos\/([0-9a-f-]{36})/)[1];

    await page.goto(`${B}/setup`);
    await page.getByLabel("Tu nombre").fill("Vista previa");
    await page.getByLabel("Correo electrónico").fill("vista@easy3d.test");
    await page.getByLabel("Contraseña").fill("contraseña-segura");
    await page.getByLabel("Cargar datos de ejemplo").check();
    await page.getByRole("button", { name: "Crear cuenta y entrar" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/setup"), { timeout: 120000 });
    await page.goto(`${B}/`);
    await page.getByRole("link", { name: "Prokeys", exact: true }).first().waitFor();
    await shot("01-grupo.jpg", "Vista de grupo", "App");

    const E = `${B}/e/prokeys`;
    await page.goto(E);
    await shot("02-resumen.jpg", "Resumen de Prokeys", "App");
    await page.goto(`${E}/pedidos?estado=todos`);
    await shot("03-pedidos.jpg", "Pedidos", "App");

    // Factura desde un pedido
    await page.locator("tbody tr a").first().click();
    await page.getByRole("button", { name: "Generar documento" }).click();
    await page.getByRole("menuitem", { name: "Factura", exact: true }).click();
    await page.waitForURL(/documentos\/nuevo/);
    await shot("04-nueva-factura.jpg", "Nueva factura desde un pedido", "Documentos");
    await page.getByRole("button", { name: "Emitir factura" }).click();
    await page.waitForURL(/documentos\/[0-9a-f-]{36}$/);
    const invoice = docId();
    await shot("05-factura.jpg", "Factura", "Documentos");

    // Presupuesto a mano → aceptado → albarán sin precios
    await page.goto(`${E}/documentos/nuevo?tipo=presupuesto`);
    await page.getByLabel("Nombre o razón social").fill("Talleres Ruiz, S.L.");
    await page.getByLabel("NIF / CIF").fill("B12345678");
    await page.getByLabel("Descripción de la línea 1").fill("Diseño y modelado de soporte a medida");
    await page.getByLabel("Cantidad de la línea 1").fill("2,5");
    await page.getByLabel("Precio de la línea 1").fill("35");
    await page.getByRole("button", { name: "Emitir presupuesto" }).click();
    await page.waitForURL(/documentos\/[0-9a-f-]{36}$/);
    await shot("06-presupuesto.jpg", "Presupuesto", "Documentos");
    await page.getByRole("link", { name: "Sacar albarán" }).click();
    await page.waitForURL(/albaran/);
    await page.getByLabel("Mostrar precios e importes").uncheck();
    await page.getByRole("button", { name: "Emitir albarán" }).click();
    await page.waitForURL(/documentos\/[0-9a-f-]{36}$/);
    await shot("07-albaran.jpg", "Albarán sin precios", "Documentos");

    await page.goto(`${E}/documentos`);
    await shot("08-documentos.jpg", "Listado de documentos y plantillas de contrato", "Documentos");
    await page.goto(`${E}/documentos/contratos/prestacion-servicios`);
    await shot("09-contrato.jpg", "Contrato de fabricación por impresión 3D", "Documentos");
    await page.goto(`${E}/documentos/${invoice}/imprimir`);
    await shot("10-imprimir.jpg", "Vista de impresión / PDF", "Documentos");
    await page.goto(`${E}/ajustes`);
    await shot("11-ajustes.jpg", "Ajustes: datos fiscales y documentos", "App");

    // Móvil, tema claro
    await ctx.addCookies([{ name: "e3d_theme", value: "light", url: B }]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${E}/documentos`);
    await shot("12-movil-documentos.jpg", "Móvil · Documentos (tema claro)", "Móvil");
    await page.goto(`${E}/documentos/${invoice}`);
    await shot("13-movil-factura.jpg", "Móvil · Factura (tema claro)", "Móvil");
    await browser.close();
    fs.writeFileSync(path.join(out, "capturas.json"), JSON.stringify(shots, null, 2));
    console.log(`${shots.length} capturas en ${out}`);
  } finally {
    try {
      process.kill(-server.pid);
    } catch {}
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
