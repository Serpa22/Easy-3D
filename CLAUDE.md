# Easy 3D

Aplicación de gestión para una empresa de impresión 3D con **sub-empresas** (p. ej. «Teclas» para teclados, «Figuras»…). Desde la app se entra a cada sub-empresa y se controla de forma independiente: finanzas (ingresos y gastos), pedidos, clientes, envíos, productos y costes, maquinaria con estado **en directo**, historial de impresiones, materiales, energía/luz. Además hay una vista de grupo que resume todas.

Toda la interfaz está en **español de España**. Moneda EUR, formato es-ES, zona horaria por defecto Europe/Madrid.

## Stack

- **Next.js 16** (App Router, Turbopack, React 19) + TypeScript estricto. `cacheComponents` está DESACTIVADO: todo es renderizado dinámico clásico.
- **Esta versión de Next.js tiene cambios respecto a lo que recuerdas.** Antes de usar una API de Next de la que no estés seguro, lee la guía en `node_modules/next/dist/docs/` (p. ej. `params`/`searchParams`/`cookies()`/`headers()` son asíncronos; `middleware` ahora es `src/proxy.ts`).
- **Tailwind CSS 4** con tokens propios en `src/app/globals.css`.
- **Drizzle ORM** sobre PostgreSQL. Sin `DATABASE_URL` usa **PGlite** (Postgres embebido en `.data/`); con `DATABASE_URL` usa un Postgres real (Supabase…). Mismo esquema y consultas para ambos.
- **zod 4** para validar. **lucide-react** para iconos. Gráficos propios en `src/components/charts` (d3-scale / d3-shape).
- Impresoras: `mqtt` (Bambu Lab) y `ws` (Moonraker, Elegoo) solo en servidor / bridge.

## Comandos

- `npm run dev` — servidor de desarrollo (http://localhost:3000)
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint
- `npm test` — tests unitarios (vitest)
- `E3D_TEST_DATABASE_URL=postgres://… npm run test:pg` — los mismos tests contra un PostgreSQL real (vacía esa BD). Pásalos antes de dar por buena una consulta nueva: PGlite es más permisivo
- `npm run test:e2e` — Playwright
- `npm run db:generate` — genera una migración SQL en `drizzle/` tras cambiar `schema.ts` (se aplican solas al arrancar)
- `npm run build` — build de producción

## Estructura

```
src/app/                      rutas (App Router)
  (auth)/login, (auth)/setup  acceso y primer arranque
  (app)/                      zona autenticada (layout con barra lateral)
    page.tsx                  vista de grupo (todas las sub-empresas)
    e/[company]/…             una sub-empresa: resumen, finanzas, pedidos, documentos, envios, clientes,
                              productos, maquinas, impresiones, materiales, energia, ajustes
  (print)/e/[company]/…       hojas para imprimir / guardar en PDF (documentos y contratos), sin barra lateral
    ajustes/                  ajustes globales (organización, usuarios, conexiones/bridges)
  api/                        route handlers (live, bridge, health)
src/components/ui/            kit de interfaz: button, form (controles, Field, ActionForm, useAction, filtros por URL),
                              dialog, menu, actions (FormDialogButton, ActionsMenu, ActionButton), display (Card, Stat,
                              Badge, StatusDot, EmptyState, PageHeader, Alert…), table (DataTable), nav (TabsNav,
                              Pagination, MonthNav, FilterChips), toast, client-bits (ThemeToggle, CopyButton, RelativeTime)
src/components/charts/        gráficos: bar-chart, line-chart, simple (BarList, StackedBar, Sparkline)
src/components/<módulo>/      componentes de cada módulo
src/lib/                      código isomórfico: domain.ts (enums + etiquetas), format.ts, dates.ts,
                              validation.ts, telemetry.ts, action.ts, cn.ts
src/server/                   solo servidor
  db/schema.ts                esquema (fuente de verdad), db/index.ts (getDb), db/sql.ts (sum/count)
  auth/                       sesiones y contraseñas
  context.ts                  requireCompany(slug) → { user, company, db, org }
  action.ts                   runAction / parseForm / ActionError
  domain/                     lógica de negocio compartida (ledger, energía, costes, stock…)
  queries/<módulo>.ts         lecturas por módulo
  actions/<módulo>.ts         Server Actions por módulo ("use server")
  printers/                   adaptadores de impresoras, gestor de conexiones, ingest de telemetría
bridge/                       programa que corre en el taller y reenvía telemetría a la app
drizzle/                      migraciones SQL generadas
```

## Reglas de datos (obligatorias)

1. **Aislamiento por empresa.** Toda página y acción de `/e/[company]/…` empieza con `const { company, db, org } = await requireCompany(slug)`. Toda consulta y escritura filtra por `company.id`. Nunca aceptes un `companyId` del cliente. Al cargar o modificar una fila por `id`, añade siempre `and(eq(tabla.id, id), eq(tabla.companyId, company.id))`.
2. **Dinero en céntimos enteros** (`amountCents`, `priceCents`…). Nunca floats para dinero. Entrada del usuario → `zCents()` de `@/lib/validation` (acepta «12,50»). Salida → `formatMoney()` de `@/lib/format`.
3. **Fechas contables** como cadena `'YYYY-MM-DD'`; «hoy» es `todayISO(org.timeZone)` de `@/lib/dates`, nunca `new Date()` a pelo. Instantes como `Date` (timestamptz).
4. **Enums y etiquetas** salen de `@/lib/domain` (p. ej. `ORDER_STATUS_LABELS`). No escribas etiquetas de estado a mano ni inventes valores nuevos.
5. **Sumas SQL**: usa `sum()`, `count()`, `sumWhere()`, `countWhere()` de `@/server/db/sql` (devuelven `number` con ambos drivers). No uses `db.execute()` con SQL crudo salvo que sea imprescindible: el formato del resultado difiere entre drivers.
6. **Libro contable derivado.** Los movimientos que nacen de otro registro (pedido cobrado, coste de envío, compra de material, mantenimiento, factura de luz…) NO se insertan a mano: usa `syncLedgerEntry()` / `removeLedgerEntry()` de `@/server/domain/ledger`, que los mantiene sincronizados e idempotentes.
7. Las escrituras que tocan varias tablas van en `db.transaction(async (tx) => …)`.
8. `machines.connectionConfig` contiene secretos (claves de acceso de impresoras): **nunca** se envía al navegador.
9. **Instantes dentro de `sql\`…\``**: nunca interpoles un `Date` suelto (postgres-js falla; PGlite no). Usa `gte()/lt()` o `instant(fecha)` de `@/server/db/sql`.
10. **Stock**. El de material es la suma exacta de sus movimientos y puede ser negativo (no lo recortes a 0). El de producto no baja de 0, así que quien lo descuenta apunta cuánto descontó de verdad (`order_items.stockDeductedQty`) y las correcciones aplican solo la diferencia: nunca «deshacer y volver a aplicar» a través de un `greatest(…, 0)`.
11. **Empresas de ejemplo**: se reconocen solo por `companies.demoKey`, que escribe únicamente el generador de datos. Ni el nombre, ni la URL, ni la descripción autorizan a borrarlas ni a reutilizarlas.
12. **Registros**: usa `logError()` de `@/server/log`, no `console.error(error)`: un error de consulta arrastra sus parámetros (claves, datos personales).

## Patrón de un módulo

- **Página** (`page.tsx`, Server Component): `const { company } = await requireCompany((await params).company)`, llama a funciones de `src/server/queries/<módulo>.ts` y pinta. Filtros y paginación por `searchParams` (URL compartible).
- **Server Actions** en `src/server/actions/<módulo>.ts` con `"use server"`. Firma para formularios: `(slug: string, prev: ActionState, formData: FormData) => Promise<ActionResult>`; se enlaza con `action.bind(null, slug)`. Cuerpo siempre dentro de `runAction(async () => { … })` y validado con `parseForm(schema, formData)`. Tras escribir: `revalidatePath(...)`. Devuelve `{ message: "…" }` para el toast.
- **Formularios**: `ActionForm` + `Field` + `SubmitButton` del kit (gestionan estado pendiente, errores por campo y toast). Altas y ediciones en `Dialog`; borrados con confirmación. Para formularios sencillos no hace falta un componente cliente: `FormDialogButton` y `ActionsMenu` (`@/components/ui/actions`) reciben los campos como hijos y la Server Action ya enlazada.
- La lógica que deba probarse va en funciones puras de `(db, companyId, datos)` en `src/server/domain/*-service.ts`; la Server Action es un envoltorio fino.
- Lecturas: nunca hagas fetch desde el cliente a la BD; pasa datos serializables del Server Component al Client Component.

## Reglas de diseño (obligatorias)

Estética: **monocromo negro/blanco, elegante, sobria, muy legible**. Tema oscuro por defecto y tema claro; ambos deben verse bien.

- Colores **solo** mediante los tokens de `globals.css` (`bg-bg`, `bg-surface`, `bg-elevated`, `text-fg`, `text-fg-2`, `text-fg-3`, `border-line`, `border-control`, `bg-primary text-primary-fg`…). La paleta por defecto de Tailwind está eliminada: `text-gray-500` o `bg-white` **no existen**. Nada de colores hex sueltos.
- `ok` / `warn` / `danger` son la única excepción al monocromo y se reservan para **estado**, siempre acompañados de icono o texto. Nunca como decoración.
- Nada de degradados de colores, ni emojis como iconos (usa `lucide-react`), ni sombras duras. Radios solo de la escala (`rounded-sm|md|lg|xl`).
- Contraste AA (4.5:1 texto; 3:1 texto grande y bordes de controles). Foco visible (ya viene global). Todo elemento clicable tiene `hover` y `active`. Área táctil ≥ 44×44 px en móvil.
- HTML semántico; un solo `h1` por página (lo pone `PageHeader`). El `body` nunca hace scroll horizontal: tablas y gráficos anchos van dentro de un contenedor `scroll-x`.
- Cifras con `tabular` (font-variant-numeric) y, en KPIs, `font-mono`.
- Responsive real: debe usarse bien a 390 px y a 1440 px.
- Texto de interfaz real y específico del negocio, en español. Nada de lorem ipsum. Estados vacíos con explicación y acción.
- Usa SIEMPRE los componentes del kit (`@/components/ui`) antes de crear uno nuevo; si falta algo genérico, añádelo al kit en vez de duplicar estilos.
- Animación discreta (150–300 ms, `ease-out-expo`), respetando `prefers-reduced-motion` (ya global).

## Verificación

Antes de dar algo por terminado: `npm run typecheck`, `npm run lint`, `npm test`, y mira la pantalla de verdad (Playwright a 1440 px y 390 px, tema oscuro y claro) comprobando desbordes, solapes, contraste y consola sin errores. `npm run build && npm run test:e2e` recorre el primer arranque, las máquinas en directo, finanzas, pedidos y la sesión contra el build de producción.

## Documentos y contratos

- Facturas, rectificativas, presupuestos y albaranes en `documents` (+ `document_items`, `document_sequences`). Lógica en `domain/documents-service.ts`, cálculo de importes en `lib/documents.ts` (`computeDocumentTotals`, compartido con el formulario).
- Numeración correlativa por empresa, tipo y año; en facturas y rectificativas la fecha respeta el orden de la serie y solo se borra la última. Guardan copia de emisor y cliente (`issuer`/`customer`). No tocan Finanzas ni stock.
- Plantillas de contrato en `lib/contract-templates.ts`: un único texto para la app y para los Word de `public/plantillas/` (regenerar con `scripts/export-contracts.ts` + `scripts/build-contract-docx.py`).
- La hoja impresa usa `.paper.theme-light` (tokens claros en cualquier tema) y las reglas `@media print` de `globals.css`.

## Impresoras

- Un adaptador por protocolo en `src/server/printers/adapters/<tipo>.ts`: exporta `createAdapter` y una función pura `mapXxx` (probada) que traduce al modelo común `PrinterTelemetry` (`src/lib/telemetry.ts`).
- `adapters/**`, `manager.ts`, `registry.ts` y `types.ts` se ejecutan también en el bridge (Node puro): no importan `server-only`, `next/*` ni alias `@/`.
- La dirección de una impresora se valida con `src/lib/net-target.ts` (al guardar y otra vez en el adaptador). Los adaptadores no siguen redirecciones ni devuelven al usuario texto del equipo remoto; un secreto guardado no se reutiliza si cambia el destino (`mergeConnectionConfig`).
- `ingest.ts` convierte telemetría en hechos (estado en directo, impresiones abiertas/cerradas, eventos). Toda apertura o cierre de impresión pasa por `domain/print-jobs.ts`.
