/**
 * Definición de los datos de conexión de cada tipo de impresora.
 * Isomórfico: el formulario de máquina se genera a partir de aquí y el
 * servidor valida con las mismas definiciones.
 *
 * Los campos marcados como `secret` nunca se envían al navegador: el
 * formulario muestra «guardada» y solo se sobrescriben si se escribe un valor.
 */
import type { ConnectionType } from "./domain";

export interface ConnectionField {
  key: string;
  label: string;
  type: "text" | "password" | "number";
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  /** Ayuda: qué es y dónde se encuentra en la impresora. */
  help?: string;
  /** Valor por defecto si se deja vacío. */
  defaultValue?: string | number;
}

export interface ConnectionSpec {
  type: ConnectionType;
  /** Explicación breve de cómo funciona esta conexión. */
  summary: string;
  /** Pasos para prepararla en la impresora. */
  steps: string[];
  fields: ConnectionField[];
}

export type ConnectionConfig = Record<string, string | number | boolean | undefined>;

export const CONNECTION_SPECS: Record<ConnectionType, ConnectionSpec> = {
  none: {
    type: "none",
    summary: "Sin conexión: apuntas las impresiones a mano y la app estima el progreso por tiempo.",
    steps: [],
    fields: [],
  },
  simulator: {
    type: "simulator",
    summary: "Impresora simulada para probar la app: genera impresiones, temperaturas y eventos realistas.",
    steps: [],
    fields: [
      {
        key: "speed",
        label: "Velocidad de simulación",
        type: "number",
        defaultValue: 4,
        help: "1 = tiempo real. 4 = una impresión de 2 h dura 30 min.",
      },
    ],
  },
  bambu: {
    type: "bambu",
    summary: "Conexión local con impresoras Bambu Lab (X1, P1, A1, P2S, H2…). Solo lectura: la app no envía órdenes a la impresora.",
    steps: [
      "En la pantalla de la impresora abre Ajustes → Red (WLAN): ahí están la dirección IP y el «Código de acceso».",
      "El número de serie está en Ajustes → Dispositivo (también en Bambu Studio o Bambu Handy).",
      "La impresora debe estar en la misma red que el equipo donde corre la app (o el bridge). No hace falta activar el modo «Solo LAN».",
      "Si reinicias la impresora de fábrica o renuevas el código, actualízalo aquí.",
    ],
    fields: [
      { key: "host", label: "Dirección IP", type: "text", required: true, placeholder: "192.168.1.50" },
      { key: "serial", label: "Número de serie", type: "text", required: true, placeholder: "01P00A123456789" },
      { key: "accessCode", label: "Código de acceso LAN", type: "password", required: true, secret: true },
    ],
  },
  moonraker: {
    type: "moonraker",
    summary: "Impresoras con Klipper y Moonraker (Voron, Sovol, QIDI, Elegoo Neptune 4, Creality K1 con acceso root…).",
    steps: [
      "Usa la misma dirección con la que abres Mainsail o Fluidd en el navegador (IP o nombre, sin «http://»).",
      "El puerto de Moonraker es 7125 salvo que lo hayas cambiado.",
      "Si Moonraker exige autenticación, copia la clave API desde los ajustes de Mainsail/Fluidd. En redes domésticas normalmente no hace falta.",
    ],
    fields: [
      { key: "host", label: "Dirección (IP o nombre)", type: "text", required: true, placeholder: "192.168.1.60" },
      { key: "port", label: "Puerto", type: "number", defaultValue: 7125 },
      { key: "apiKey", label: "Clave API (si está activada)", type: "password", secret: true },
    ],
  },
  octoprint: {
    type: "octoprint",
    summary: "Impresoras controladas con OctoPrint (OctoPi).",
    steps: [
      "Dirección: la que usas para abrir OctoPrint, por ejemplo http://octopi.local o http://192.168.1.70.",
      "Clave API: en OctoPrint, Ajustes → «Application Keys» (o «API») → genera una clave para Easy 3D.",
    ],
    fields: [
      { key: "baseUrl", label: "Dirección de OctoPrint", type: "text", required: true, placeholder: "http://192.168.1.70" },
      { key: "apiKey", label: "Clave API", type: "password", required: true, secret: true },
    ],
  },
  prusalink: {
    type: "prusalink",
    summary: "Impresoras Prusa con PrusaLink (MK4, MK3.9, MINI, XL, CORE One…).",
    steps: [
      "En la impresora: Ajustes → Red → PrusaLink. Ahí aparecen la dirección IP y la clave API (o el usuario «maker» y su contraseña).",
      "Rellena la clave API o bien el usuario y la contraseña: basta con una de las dos opciones.",
    ],
    fields: [
      { key: "host", label: "Dirección IP", type: "text", required: true, placeholder: "192.168.1.80" },
      { key: "apiKey", label: "Clave API (PrusaLink)", type: "password", secret: true },
      { key: "username", label: "Usuario (si usa contraseña)", type: "text", placeholder: "maker" },
      { key: "password", label: "Contraseña", type: "password", secret: true },
    ],
  },
  elegoo: {
    type: "elegoo",
    summary: "Experimental. Impresoras Elegoo con protocolo SDCP (Saturn y Mars recientes, Centauri Carbon). Todavía sin validar con todos los modelos.",
    steps: [
      "La dirección IP está en la pantalla de la impresora, en Ajustes → Red.",
      "La impresora admite pocas conexiones a la vez: si ChituBox u otra app está conectada, puede rechazar la de Easy 3D.",
    ],
    fields: [
      { key: "host", label: "Dirección IP", type: "text", required: true, placeholder: "192.168.1.90" },
      { key: "mainboardId", label: "ID de placa (opcional)", type: "text", help: "Normalmente se detecta sola. Rellénalo solo si la detección falla." },
    ],
  },
};

/** Claves secretas de un tipo de conexión. */
export function secretKeys(type: ConnectionType): string[] {
  return CONNECTION_SPECS[type].fields.filter((f) => f.secret).map((f) => f.key);
}

/**
 * Versión segura para el navegador: quita los secretos y añade
 * `__has_<clave>: true` para los que ya están guardados.
 */
export function maskConnectionConfig(type: ConnectionType, config: Record<string, unknown> | null | undefined): ConnectionConfig {
  const out: ConnectionConfig = {};
  const source = config ?? {};
  for (const field of CONNECTION_SPECS[type].fields) {
    const value = source[field.key];
    if (field.secret) {
      out[`__has_${field.key}`] = typeof value === "string" ? value.length > 0 : value !== undefined && value !== null;
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[field.key] = value;
    }
  }
  return out;
}

/**
 * Combina lo enviado por el formulario con lo guardado: un secreto vacío
 * conserva el valor anterior (si el tipo de conexión no ha cambiado).
 * Devuelve también los errores de campos obligatorios.
 */
export function mergeConnectionConfig(
  type: ConnectionType,
  submitted: Record<string, unknown>,
  previous: { type: ConnectionType; config: Record<string, unknown> } | null,
): { config: Record<string, string | number>; errors: Record<string, string> } {
  const config: Record<string, string | number> = {};
  const errors: Record<string, string> = {};
  const prev = previous && previous.type === type ? previous.config : {};
  for (const field of CONNECTION_SPECS[type].fields) {
    const raw = submitted[field.key];
    let value: string | number | undefined;
    if (typeof raw === "number" && Number.isFinite(raw)) value = raw;
    else if (typeof raw === "string" && raw.trim() !== "") value = raw.trim();

    if (value === undefined && field.secret) {
      const kept = prev[field.key];
      if (typeof kept === "string" && kept !== "") value = kept;
    }
    if (value === undefined && field.defaultValue !== undefined) value = field.defaultValue;

    if (value !== undefined && field.type === "number") {
      const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
      if (!Number.isFinite(n)) {
        errors[field.key] = "Número no válido";
        continue;
      }
      value = n;
    }
    if (value === undefined) {
      if (field.required) errors[field.key] = "Campo obligatorio";
      continue;
    }
    config[field.key] = value;
  }
  return { config, errors };
}
