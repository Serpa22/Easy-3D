# Easy 3D

Aplicación para gestionar una empresa de impresión 3D organizada en **sub-empresas** (por ejemplo «Prokeys» para teclados y «Figuras»). Desde la vista de grupo se entra a cada sub-empresa y se controla por separado:

| Sección | Qué hace |
| --- | --- |
| **Resumen** | Ingresos, gastos y beneficio del mes, lo que imprime cada máquina ahora mismo y una lista de lo que requiere atención |
| **Finanzas** | Ingresos y gastos, gastos recurrentes, informe anual, IVA orientativo por trimestre y exportación a CSV |
| **Pedidos y clientes** | Pedidos con líneas, canal de venta, estado y cobro; ficha de cliente; rentabilidad estimada de cada pedido |
| **Envíos** | Transportista, seguimiento, coste y estado; el pedido avanza solo al enviarlo |
| **Productos** | Catálogo con el coste real de cada pieza (material, luz, máquina, mano de obra, fallos), margen y calculadora de costes |
| **Máquinas** | Sala de máquinas en directo: cuáles trabajan y cuáles están en reposo, pieza en curso, capas, tiempos, temperaturas y eventos |
| **Impresiones** | Historial de todo lo impreso, detectado en directo o apuntado a mano, con material, energía y coste |
| **Materiales** | Stock de filamentos, resinas y embalaje, compras, mermas y avisos de stock bajo |
| **Energía** | Consumo y coste de luz por máquina, tarifa fija o por periodos (punta/llano/valle), facturas reales y simulador |

Las secciones están conectadas: cobrar un pedido apunta el ingreso, un envío apunta su gasto, una compra de material suma stock y gasto, y una impresión terminada descuenta material, suma horas a la máquina y calcula su coste eléctrico.

Interfaz en español, en blanco y negro (tema oscuro y claro), pensada para móvil y escritorio. Se puede instalar como app desde el navegador.

## Puesta en marcha

Requiere Node.js 20.9 o superior.

```bash
npm install
npm run build
npm start          # http://localhost:3000
```

La primera vez aparece un asistente para crear tu cuenta de propietario y tu primera sub-empresa. Si marcas «Cargar datos de ejemplo» se crean dos sub-empresas de demostración con máquinas simuladas, pedidos y finanzas para explorar; se borran después desde **Ajustes generales → Datos**.

Para desarrollar: `npm run dev`.

### Dónde se guardan los datos

- **Sin configurar nada**, la app usa una base de datos PostgreSQL embebida (PGlite) en la carpeta `.data/`. Para hacer una copia basta con copiar esa carpeta con la app parada. Solo puede usarla un proceso a la vez.
- Con la variable `DATABASE_URL` usa un PostgreSQL externo (Supabase, Neon, uno propio…). Las tablas se crean solas al arrancar.

| Variable | Para qué |
| --- | --- |
| `DATABASE_URL` | PostgreSQL externo. Sin ella se usa la base embebida |
| `E3D_DATA_DIR` | Carpeta de la base embebida (por defecto `.data`) |
| `E3D_EMBEDDED_PRINTERS` | `false` para que el servidor no se conecte a las impresoras (lo hará un bridge) |
| `E3D_SECURE_COOKIES` | `true`/`false` para forzar cookies solo por HTTPS (por defecto se detecta) |
| `E3D_SETUP_TOKEN` | Código que la pantalla de primer arranque pedirá para crear la cuenta de propietario. Ponlo si despliegas en internet, para que nadie se adelante |
| `E3D_TRUST_PROXY` | Número de proxies propios delante de la app (nginx, Cloudflare…). Solo entonces se usa la IP del visitante para limitar intentos de acceso. En Vercel vale 1 por defecto |

## Conectar las impresoras

Cada máquina se da de alta en **Máquinas → Añadir máquina**. En «Conexión en directo» se elige el tipo y se rellenan sus datos; el botón «Probar conexión» comprueba que responde. Las claves de acceso se guardan en el servidor y nunca se envían al navegador. La conexión es **solo de lectura**: la app no manda órdenes a la impresora.

| Tipo | Impresoras | Datos necesarios |
| --- | --- | --- |
| Bambu Lab (LAN) | X1, P1, A1, P2S, H2… | IP, número de serie y código de acceso LAN (pantalla → Ajustes → Red) |
| Klipper / Moonraker | Voron, Sovol, QIDI, Neptune 4, K1 con root… | Dirección y puerto (7125); clave API solo si está activada |
| OctoPrint | Cualquiera con OctoPi | Dirección y clave API |
| PrusaLink | MK4, MK3.9, MINI, XL, CORE One… | IP y clave API (o usuario y contraseña) |
| Elegoo SDCP | Saturn y Mars recientes, Centauri Carbon | IP |
| Simulador | — | Genera impresiones ficticias para probar la app |
| Sin conexión | Cualquier máquina | Se apuntan las impresiones a mano y el progreso se estima por tiempo |

**Estado de las integraciones.** El simulador y todo el flujo en directo (estado, apertura y cierre de impresiones, eventos, consumo) están probados de extremo a extremo. Los adaptadores de Bambu Lab, Moonraker, OctoPrint y PrusaLink siguen la documentación y el código de referencia de cada protocolo y están probados con servidores simulados, pero **todavía no se han validado con impresoras reales**: conviene probarlos con tu equipo y revisar cualquier diferencia. El de Elegoo es **experimental**.

### Dónde corre la app y cómo llega a las impresoras

Las impresoras están en la red de tu taller, así que hay dos formas de montarlo:

1. **App en tu red local (lo más sencillo).** Ejecuta Easy 3D en un PC, mini-PC o Raspberry Pi del taller. Se conecta sola a las impresoras. Para usarla desde fuera, publica ese equipo con una VPN o un túnel (Tailscale, Cloudflare Tunnel…).
2. **App en la nube + bridge.** Aloja la app en internet con un PostgreSQL externo. Como desde internet no se ve tu red local, en un equipo del taller se ejecuta el *bridge*, un pequeño programa que lee las impresoras y envía los datos a la app:
   - En la app: **Ajustes generales → Conexiones → Crear bridge** y copia el token (solo se muestra una vez).
   - En el equipo del taller, con este repositorio descargado y `npm install` hecho:
     ```bash
     E3D_URL=https://tu-app.example E3D_BRIDGE_TOKEN=e3d_… npm run bridge
     ```
   - En cada máquina, pestaña Ajustes → «Quién se conecta a la máquina» → elige el bridge.

   Para dejarlo siempre en marcha en una Raspberry Pi puedes usar un servicio de systemd:
   ```ini
   [Unit]
   Description=Easy 3D bridge
   After=network-online.target

   [Service]
   WorkingDirectory=/home/pi/Easy-3D
   Environment=E3D_URL=https://tu-app.example
   Environment=E3D_BRIDGE_TOKEN=e3d_…
   ExecStart=/usr/bin/npm run bridge
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```

En plataformas sin proceso permanente (Vercel y similares) el servidor no puede mantener conexiones con las impresoras: usa el bridge. El estado en directo se refresca en el navegador cada 3 segundos.

## Usuarios

El primer usuario es **propietario**. Desde **Ajustes generales → Usuarios** puede añadir más personas como miembros (gestionan todas las sub-empresas) o propietarios (además cambian usuarios, conexiones y ajustes generales).

## Tests

```bash
npm run typecheck   # tipos
npm run lint        # ESLint
npm test            # tests unitarios (lógica de negocio, ingesta de telemetría, adaptadores)
npm run build && npm run test:e2e   # tests de extremo a extremo con Playwright
# Los mismos tests unitarios contra un PostgreSQL real (¡vacía esa base de datos!):
E3D_TEST_DATABASE_URL=postgres://usuario@localhost:5432/easy3d_test npm run test:pg
```

## Estructura

```
src/app/            rutas: (auth) acceso · (app) zona autenticada · api
src/components/     ui (kit de interfaz) · charts · un directorio por módulo
src/lib/            código compartido: vocabulario del dominio, formato, fechas, costes, energía
src/server/         esquema y acceso a datos, autenticación, lógica de negocio, consultas, acciones
src/server/printers adaptadores de impresoras, gestor de conexiones e ingesta de telemetría
bridge/             programa puente para el taller
drizzle/            migraciones SQL
tests/              tests unitarios y de extremo a extremo
```

Las convenciones de desarrollo están en `CLAUDE.md`.
