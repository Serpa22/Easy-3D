/**
 * Definición de los datos de conexión de cada tipo de impresora.
 * Isomórfico: el formulario de máquina se genera a partir de aquí y el
 * servidor valida con las mismas definiciones.
 *
 * Los campos marcados como `secret` nunca se envían al navegador: el
 * formulario muestra «guardada» y solo se sobrescriben si se escribe un valor.
 */
import type { ConnectionType } from "./domain";
import { checkTarget, type TargetOptions } from "./net-target";

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
  /** Límites de un campo numérico. */
  min?: number;
  max?: number;
  /** El campo es la dirección de la impresora: qué formas se admiten. */
  address?: TargetOptions;
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
        min: 0.1,
        max: 600,
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
      { key: "host", label: "Dirección IP", type: "text", required: true, placeholder: "192.168.1.50", address: {} },
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
      { key: "host", label: "Dirección (IP o nombre)", type: "text", required: true, placeholder: "192.168.1.60", address: { scheme: true, port: true } },
      { key: "port", label: "Puerto", type: "number", defaultValue: 7125, min: 1, max: 65535 },
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
      { key: "baseUrl", label: "Dirección de OctoPrint", type: "text", required: true, placeholder: "http://192.168.1.70", address: { scheme: true, port: true, path: true } },
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
      { key: "host", label: "Dirección IP", type: "text", required: true, placeholder: "192.168.1.80", address: { scheme: true, port: true } },
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
      { key: "host", label: "Dirección IP", type: "text", required: true, placeholder: "192.168.1.90", address: {} },
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

/** Lee un campo del formulario: número, texto no vacío o nada. */
function submittedValue(field: ConnectionField, raw: unknown): { value?: string | number; error?: string } {
  let value: string | number | undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) value = raw;
  else if (typeof raw === "string" && raw.trim() !== "") value = raw.trim();
  if (value === undefined) return {};

  if (field.type === "number") {
    const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
    if (!Number.isFinite(n)) return { error: "Número no válido" };
    if ((field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)) {
      return { error: `Debe estar entre ${field.min ?? "−∞"} y ${field.max ?? "∞"}` };
    }
    return { value: n };
  }
  const text = String(value);
  if (text.length > 300) return { error: "Demasiado largo" };
  if (field.address) {
    const checked = checkTarget(text, field.address);
    if ("error" in checked) return { error: checked.error };
  }
  return { value: text };
}

/**
 * Combina lo enviado por el formulario con lo guardado y valida.
 *
 * Un secreto que se deja vacío conserva el valor guardado **solo si no ha
 * cambiado nada más de la conexión** (mismo tipo, misma dirección, mismo
 * puerto…). Si cambia el destino hay que volver a escribirlo: así nadie puede
 * redirigir una clave guardada hacia otra dirección sin conocerla.
 *
 * Un secreto opcional guardado se puede quitar enviando `<clave>__clear`.
 */
export function mergeConnectionConfig(
  type: ConnectionType,
  submitted: Record<string, unknown>,
  previous: { type: ConnectionType; config: Record<string, unknown> } | null,
): { config: Record<string, string | number>; errors: Record<string, string> } {
  const config: Record<string, string | number> = {};
  const errors: Record<string, string> = {};
  const prev = previous && previous.type === type ? previous.config : {};
  const fields = CONNECTION_SPECS[type].fields;

  // 1) Campos no secretos: definen a dónde se conecta la app.
  let targetChanged = false;
  for (const field of fields) {
    if (field.secret) continue;
    const { value: typed, error } = submittedValue(field, submitted[field.key]);
    if (error) {
      errors[field.key] = error;
      continue;
    }
    const value = typed ?? field.defaultValue;
    const before = prev[field.key] ?? field.defaultValue;
    if (String(value ?? "") !== String(before ?? "")) targetChanged = true;
    if (value === undefined) {
      if (field.required) errors[field.key] = "Campo obligatorio";
      continue;
    }
    config[field.key] = value;
  }

  // 2) Secretos: lo escrito manda; vacío conserva lo guardado si el destino es el mismo.
  for (const field of fields) {
    if (!field.secret) continue;
    const { value: typed, error } = submittedValue(field, submitted[field.key]);
    if (error) {
      errors[field.key] = error;
      continue;
    }
    let value = typed;
    if (value === undefined) {
      const kept = prev[field.key];
      const hasKept = typeof kept === "string" && kept !== "";
      const clear = !field.required && Boolean(submitted[`${field.key}__clear`]);
      if (hasKept && !clear) {
        if (targetChanged) {
          errors[field.key] = "Has cambiado los datos de la conexión: por seguridad, vuelve a escribir este dato.";
          continue;
        }
        value = kept;
      }
    }
    if (value === undefined) {
      if (field.required) errors[field.key] = "Campo obligatorio";
      continue;
    }
    config[field.key] = value;
  }
  return { config, errors };
}
