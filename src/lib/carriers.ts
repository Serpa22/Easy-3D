/**
 * Transportistas habituales en España y sus enlaces de seguimiento.
 * `trackingUrl` usa «{n}» como marcador del número de seguimiento. Si un
 * transportista cambia su web, el enlace de cada envío se puede editar a mano.
 */
export interface Carrier {
  id: string;
  label: string;
  trackingUrl?: string;
}

export const CARRIERS: Carrier[] = [
  { id: "correos", label: "Correos", trackingUrl: "https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number={n}" },
  { id: "correos_express", label: "Correos Express", trackingUrl: "https://s.correosexpress.com/SeguimientoSinCP/search?shippingNumber={n}" },
  { id: "seur", label: "SEUR", trackingUrl: "https://www.seur.com/livetracking/?segOnlineIdentificador={n}" },
  { id: "mrw", label: "MRW", trackingUrl: "https://www.mrw.es/seguimiento_envios/MRW_resultados_consultas.asp?modo=nacional&envio={n}" },
  { id: "gls", label: "GLS", trackingUrl: "https://mygls.gls-spain.es/e/{n}" },
  { id: "nacex", label: "NACEX" },
  { id: "ctt", label: "CTT Express", trackingUrl: "https://www.cttexpress.com/localizador-de-envios/?sc={n}" },
  { id: "inpost", label: "InPost", trackingUrl: "https://inpost.es/seguimiento-de-envios/?number={n}" },
  { id: "dhl", label: "DHL", trackingUrl: "https://www.dhl.com/es-es/home/tracking.html?tracking-id={n}" },
  { id: "ups", label: "UPS", trackingUrl: "https://www.ups.com/track?loc=es_ES&tracknum={n}" },
  { id: "fedex", label: "FedEx", trackingUrl: "https://www.fedex.com/fedextrack/?trknbr={n}" },
  { id: "packlink", label: "Packlink" },
  { id: "pickup", label: "Recogida en mano" },
  { id: "other", label: "Otro" },
];

const BY_ID = new Map(CARRIERS.map((c) => [c.id, c]));

/** Nombre visible de un transportista (clave conocida o texto libre). */
export function carrierLabel(carrier: string | null | undefined): string {
  if (!carrier) return "—";
  return BY_ID.get(carrier)?.label ?? carrier;
}

/** Enlace de seguimiento calculado, o null si el transportista no tiene plantilla. */
export function trackingUrlFor(carrier: string | null | undefined, trackingNumber: string | null | undefined): string | null {
  const number = trackingNumber?.trim();
  if (!carrier || !number) return null;
  const template = BY_ID.get(carrier)?.trackingUrl;
  return template ? template.replace("{n}", encodeURIComponent(number)) : null;
}
