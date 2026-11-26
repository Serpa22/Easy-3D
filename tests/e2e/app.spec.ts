import { expect, test, type Page } from "@playwright/test";

const USER = { email: "prueba@easy3d.test", password: "contraseña-segura" };

test.describe.configure({ mode: "serial" });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});
test.afterAll(async () => {
  await page.close();
});

test("primer arranque: crea la cuenta y carga los datos de ejemplo", async () => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel("Tu nombre").fill("Prueba");
  await page.getByLabel("Correo electrónico").fill(USER.email);
  await page.getByLabel("Contraseña").fill(USER.password);
  await page.getByLabel("Cargar datos de ejemplo").check();
  await page.getByRole("button", { name: "Crear cuenta y entrar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Easy 3D" })).toBeVisible({ timeout: 60_000 });
  // La vista de grupo enseña las dos sub-empresas de demostración.
  await expect(page.getByRole("link", { name: "Teclas", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Figuras", exact: true }).first()).toBeVisible();
});

test("entra en una sub-empresa y ve sus máquinas en directo", async () => {
  await page.goto("/e/teclas/maquinas");
  await expect(page.getByRole("heading", { level: 1, name: "Máquinas" })).toBeVisible();
  await expect(page.getByText(/máquinas trabajando ahora/)).toBeVisible();
  // Las impresoras simuladas empiezan a informar en unos segundos.
  await expect(page.getByText(/Imprimiendo|Preparando|En reposo|Terminada|En pausa/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Bambu Lab P1S · 1" })).toBeVisible();
  await page.getByRole("link", { name: "Bambu Lab P1S · 1" }).click();
  await expect(page.getByRole("heading", { name: "Eventos en directo" })).toBeVisible();
  // El estado en directo llega por /api/live.
  const live = await page.request.get("/api/live?company=teclas");
  expect(live.ok()).toBeTruthy();
  const snapshot = await live.json();
  expect(snapshot.machines.length).toBe(5);
  expect(snapshot.machines.filter((m: { source: string }) => m.source === "live").length).toBe(3);
});

test("finanzas: crea, valida y elimina un gasto manual", async () => {
  await page.goto("/e/teclas/finanzas");
  await page.getByRole("button", { name: "Nuevo gasto" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Concepto").fill("Pinzas de precisión E2E");
  await dialog.getByLabel("Importe (IVA incluido)").fill("doce");
  await dialog.getByRole("button", { name: "Añadir gasto" }).click();
  await expect(dialog.getByText("Importe no válido")).toBeVisible();
  await expect(dialog.getByLabel("Concepto")).toHaveValue("Pinzas de precisión E2E"); // no se pierde lo escrito
  await dialog.getByLabel("Importe (IVA incluido)").fill("12,90");
  await dialog.getByRole("button", { name: "Añadir gasto" }).click();
  await expect(page.getByText("Gasto añadido")).toBeVisible();
  const row = page.getByRole("row", { name: /Pinzas de precisión E2E/ });
  await expect(row).toContainText("−12,90 €");
  await row.getByRole("button", { name: /Acciones de/ }).click();
  await page.getByRole("menuitem", { name: "Eliminar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect(page.getByText("Movimiento eliminado")).toBeVisible();
  await expect(page.getByRole("row", { name: /Pinzas de precisión E2E/ })).toHaveCount(0);
});

test("máquina: editarla no borra su gasto de compra, y una dirección mal escrita se rechaza", async () => {
  await page.goto("/e/teclas/maquinas");
  await page.getByRole("button", { name: "Añadir máquina" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Nombre/).fill("Impresora E2E");
  await dialog.getByLabel("Precio de compra").fill("699");
  await dialog.getByRole("textbox", { name: "Fecha de compra" }).fill("2026-01-15");
  await dialog.getByLabel("Registrar la compra como gasto en Finanzas").check();
  // Dirección de Moonraker mal escrita: se rechaza al guardar, con el error en su campo.
  await dialog.getByLabel("Tipo de conexión").selectOption("moonraker");
  await dialog.getByLabel(/^Dirección \(IP o nombre\)/).fill("192.168.1.60:7125:7125");
  await dialog.getByRole("button", { name: "Añadir máquina" }).click();
  await expect(dialog.getByText(/Dirección no válida/)).toBeVisible();
  await dialog.getByLabel("Tipo de conexión").selectOption("none");
  await dialog.getByRole("button", { name: "Añadir máquina" }).click();
  await expect(page.getByText("Máquina añadida")).toBeVisible();

  const expense = () => page.getByRole("row", { name: /Compra de Impresora E2E/ });
  await page.goto("/e/teclas/finanzas?mes=2026-01");
  await expect(expense()).toContainText("−699,00 €");

  // Se edita otro dato de la máquina y se guarda: la casilla sale marcada y el gasto sigue ahí.
  await page.goto("/e/teclas/maquinas");
  await page.getByRole("link", { name: "Impresora E2E" }).click();
  await expect(page).toHaveURL(/\/maquinas\/[0-9a-f-]{36}$/);
  await page.goto(`${page.url()}?tab=ajustes`);
  await expect(page.getByLabel("Registrar la compra como gasto en Finanzas")).toBeChecked();
  await page.getByLabel("Ubicación").fill("Estantería 2");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Máquina actualizada")).toBeVisible();
  await page.goto("/e/teclas/finanzas?mes=2026-01");
  await expect(expense()).toContainText("−699,00 €");
});

test("pedido: al cobrarlo aparece el ingreso en finanzas y no se ve desde otra sub-empresa", async () => {
  await page.goto("/e/teclas/pedidos/nuevo");
  await page.getByLabel(/^Nombre/).fill("Cliente E2E");
  await page.getByLabel("Descripción de la línea 1").fill("Tecla a medida");
  await page.getByLabel("Precio de la línea 1").fill("19,90");
  await page.getByLabel("Cantidad de la línea 1").fill("2");
  await expect(page.getByText("39,80 €").first()).toBeVisible(); // total en vivo
  await page.getByRole("button", { name: "Crear pedido" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Pedido TEC-\d{4}/ })).toBeVisible();
  const number = (await page.getByRole("heading", { level: 1 }).innerText()).replace("Pedido ", "");

  await page.getByRole("button", { name: "Marcar cobrado" }).click();
  await expect(page.getByText("Pedido marcado como cobrado")).toBeVisible();

  await page.goto(`/e/teclas/finanzas?q=${number}`);
  await expect(page.getByRole("row", { name: new RegExp(`Pedido ${number} · Cliente E2E`) })).toContainText("+39,80 €");

  // Aislamiento: la otra sub-empresa no ve ese pedido ni su ingreso.
  await page.goto(`/e/figuras/pedidos?estado=todos&q=${number}`);
  await expect(page.getByText("Sin resultados para estos filtros")).toBeVisible();
  await page.goto(`/e/figuras/finanzas?q=${number}`);
  await expect(page.getByRole("row", { name: new RegExp(number) })).toHaveCount(0);
});

test("sesión: cerrar sesión protege la app y el acceso exige la contraseña correcta", async () => {
  await page.goto("/");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/e/teclas/finanzas");
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/live")).status()).toBe(401);

  await page.getByLabel("Correo electrónico").fill(USER.email);
  await page.getByLabel("Contraseña").fill("incorrecta");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("Correo o contraseña incorrectos.")).toBeVisible();
  await page.getByLabel("Contraseña").fill(USER.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Easy 3D" })).toBeVisible();
});

test("sin JavaScript, enviar el acceso no deja la contraseña en la URL", async ({ browser }) => {
  // Lo mismo ocurre si alguien pulsa «Entrar» antes de que la página termine de cargar.
  const context = await browser.newContext({ javaScriptEnabled: false });
  const plain = await context.newPage();
  await plain.goto("/login");
  await plain.fill("input[name=email]", USER.email);
  await plain.fill("input[name=password]", "no-debe-verse");
  await plain.locator("form button[type=submit]").click();
  await plain.waitForLoadState();
  expect(plain.url()).not.toContain("no-debe-verse");
  expect(plain.url()).not.toContain("password");
  await context.close();
});

test("documentos: factura desde un pedido, rectificativa y vista de impresión", async () => {
  await page.goto("/e/teclas/pedidos?estado=todos");
  await page.locator("tbody tr a").first().click();
  await page.getByRole("button", { name: "Generar documento" }).click();
  await page.getByRole("menuitem", { name: "Factura", exact: true }).click();
  await page.getByRole("button", { name: "Emitir factura" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Factura F\d{4}-0001$/ })).toBeVisible();
  await page.getByRole("link", { name: "Rectificar" }).click();
  await page.getByLabel("Motivo").fill("Devolución");
  await page.getByRole("button", { name: "Emitir factura rectificativa" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Factura rectificativa R\d{4}-0001$/ })).toBeVisible();
  await page.getByRole("link", { name: "Imprimir o PDF" }).click();
  await expect(page.getByRole("button", { name: "Imprimir o guardar PDF" })).toBeVisible();
  await expect(page.getByText("Rectifica la factura")).toBeVisible();
});
