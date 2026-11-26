/**
 * Plantillas de contrato. Un único texto sirve para:
 *  - la app: se rellena con los datos fiscales de la sub-empresa, del cliente
 *    elegido y de los campos del formulario, y se imprime o guarda en PDF;
 *  - los Word descargables de `public/plantillas/` (ver `scripts/build-contract-docx.py`),
 *    donde cada hueco queda como «[Texto a rellenar]».
 *
 * Huecos: `{{empresa.nombre}}`, `{{cliente.nif}}`, `{{campo.precio}}`… Son
 * modelos orientativos según la normativa española; conviene que un asesor
 * los revise antes de usarlos en un caso concreto.
 */

export interface ContractField {
  key: string;
  label: string;
  /** Texto del hueco en el Word: «[Precio total]». */
  placeholder: string;
  type?: "text" | "textarea" | "number";
  hint?: string;
  default?: string;
}

export interface ContractClause {
  title: string;
  /** Párrafos. */
  body: string[];
}

export interface ContractTemplate {
  slug: string;
  title: string;
  summary: string;
  /** false: documento unilateral (condiciones generales), sin cliente ni firmas. */
  parties: boolean;
  /** Cómo se llama a cada parte en el texto. */
  providerRole: string;
  clientRole: string;
  fields: ContractField[];
  /** Párrafo de exposición tras las partes. */
  recitals: string[];
  clauses: ContractClause[];
}

/** Huecos comunes a todas las plantillas (datos de las partes). */
export const PARTY_PLACEHOLDERS: Record<string, string> = {
  "empresa.nombre": "[Nombre o razón social del prestador]",
  "empresa.comercial": "[Nombre comercial]",
  "empresa.nif": "[NIF del prestador]",
  "empresa.domicilio": "[Domicilio del prestador]",
  "empresa.email": "[Correo del prestador]",
  "empresa.web": "[Web]",
  "cliente.nombre": "[Nombre o razón social del cliente]",
  "cliente.nif": "[NIF del cliente]",
  "cliente.domicilio": "[Domicilio del cliente]",
  "cliente.email": "[Correo del cliente]",
  lugar: "[Ciudad]",
  fecha: "[Fecha]",
};

const DATA_CLAUSE: ContractClause = {
  title: "Protección de datos",
  body: [
    "Cada parte tratará los datos personales de la otra (y de sus representantes y contactos) con la única finalidad de gestionar este contrato, conforme al Reglamento (UE) 2016/679 (RGPD) y a la Ley Orgánica 3/2018 (LOPDGDD). La base jurídica es la ejecución del contrato y el cumplimiento de obligaciones legales, y los datos se conservarán mientras dure la relación y, después, durante los plazos legales de prescripción.",
    "Los interesados pueden ejercer sus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a la dirección de cada parte que figura en el encabezamiento, y reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).",
  ],
};

const LAW_CLAUSE: ContractClause = {
  title: "Ley aplicable y jurisdicción",
  body: [
    "Este contrato se rige por la legislación española. Para cualquier controversia, las partes se someten a los juzgados y tribunales de {{campo.jurisdiccion}}, salvo que el cliente actúe como consumidor, en cuyo caso serán competentes los de su domicilio.",
  ],
};

const JURISDICTION_FIELD: ContractField = { key: "jurisdiccion", label: "Juzgados competentes", placeholder: "[Ciudad de los juzgados]", hint: "Normalmente, la ciudad de tu domicilio fiscal." };

export const CONTRACT_TEMPLATES: ContractTemplate[] = [
  {
    slug: "prestacion-servicios",
    title: "Contrato de fabricación por impresión 3D",
    summary: "Encargo de piezas a medida: especificaciones, precio, plazos, tolerancias, garantía y responsabilidad.",
    parties: true,
    providerRole: "EL PRESTADOR",
    clientRole: "EL CLIENTE",
    fields: [
      { key: "objeto", label: "Piezas encargadas", placeholder: "[Descripción de las piezas]", type: "textarea", default: "Fabricación mediante impresión 3D de las piezas descritas en el presupuesto aceptado." },
      { key: "especificaciones", label: "Especificaciones técnicas", placeholder: "[Material, color, acabado, cantidad]", type: "textarea", hint: "Material, color, relleno, acabado, cantidad…" },
      { key: "precio", label: "Precio total (IVA incluido)", placeholder: "[Precio total]", default: "" },
      { key: "anticipo", label: "Anticipo", placeholder: "[Porcentaje de anticipo]", default: "50 %" },
      { key: "plazo", label: "Plazo de entrega", placeholder: "[Plazo de entrega]", default: "15 días hábiles desde la aceptación y el pago del anticipo" },
      { key: "entrega", label: "Lugar o forma de entrega", placeholder: "[Lugar de entrega]", default: "Envío por mensajería a la dirección del cliente" },
      { key: "tolerancia", label: "Tolerancia dimensional", placeholder: "[Tolerancia]", default: "±0,3 mm" },
      { key: "garantia", label: "Días para reclamar defectos", placeholder: "[Días]", type: "number", default: "15" },
      JURISDICTION_FIELD,
    ],
    recitals: [
      "Que EL PRESTADOR se dedica profesionalmente al diseño y la fabricación de piezas mediante impresión 3D.",
      "Que EL CLIENTE desea encargar la fabricación de las piezas que se describen a continuación, y ambas partes acuerdan hacerlo con arreglo a las siguientes cláusulas.",
    ],
    clauses: [
      { title: "Objeto", body: ["{{campo.objeto}}", "Especificaciones: {{campo.especificaciones}}"] },
      {
        title: "Archivos y diseño",
        body: [
          "Cuando EL CLIENTE aporte los archivos (STL, STEP, 3MF u otros), es responsable de su exactitud y de que las medidas y la geometría sean las que necesita. EL PRESTADOR podrá proponer cambios para que la pieza sea fabricable, que solo aplicará con la conformidad del cliente.",
          "EL CLIENTE garantiza que es titular de los derechos sobre los diseños que entrega, o que tiene autorización para reproducirlos, y mantendrá indemne a EL PRESTADOR frente a cualquier reclamación de terceros por propiedad intelectual o industrial.",
        ],
      },
      {
        title: "Precio y forma de pago",
        body: [
          "El precio total es de {{campo.precio}}, impuestos incluidos. EL CLIENTE abonará un anticipo del {{campo.anticipo}} al aceptar el encargo y el resto antes de la entrega, salvo otro acuerdo por escrito.",
          "Los cambios que pida EL CLIENTE una vez iniciada la fabricación se presupuestarán aparte.",
        ],
      },
      {
        title: "Plazo y entrega",
        body: [
          "El plazo de entrega es de {{campo.plazo}}. Forma de entrega: {{campo.entrega}}. El plazo se ampliará en lo que se retrase la entrega de archivos, la aprobación de muestras o el pago por parte de EL CLIENTE.",
          "Los retrasos por causas ajenas a EL PRESTADOR (averías imprevisibles, falta de suministro de material, transportista) se comunicarán en cuanto se conozcan y no darán lugar a penalización.",
        ],
      },
      {
        title: "Tolerancias y aceptación",
        body: [
          "La impresión 3D tiene características propias del proceso: líneas de capa visibles, pequeñas marcas de soportes y variaciones de color entre lotes de material. Se considera conforme una pieza cuyas medidas estén dentro de una tolerancia de {{campo.tolerancia}}, salvo que se pacte otra por escrito.",
          "EL CLIENTE revisará las piezas al recibirlas y comunicará por escrito cualquier defecto en un plazo de {{campo.garantia}} días naturales. Pasado ese plazo sin reclamación, el encargo se entenderá aceptado, sin perjuicio de los derechos que la ley reconozca a los consumidores.",
        ],
      },
      {
        title: "Garantía",
        body: [
          "EL PRESTADOR repondrá o reparará sin coste las piezas con defectos de fabricación o que no se ajusten a las especificaciones acordadas. No cubre los daños por uso indebido, esfuerzos, temperaturas o productos químicos para los que el material no es apto, ni los errores del diseño aportado por EL CLIENTE.",
          "Si EL CLIENTE actúa como consumidor, dispone además de la garantía legal de conformidad de tres años del Real Decreto Legislativo 1/2007.",
        ],
      },
      {
        title: "Responsabilidad",
        body: [
          "Las piezas se fabrican según el uso que EL CLIENTE ha descrito. Para usos estructurales, alimentarios, médicos, de seguridad o sometidos a cargas, EL CLIENTE debe validar las piezas antes de usarlas. Salvo dolo o negligencia grave, la responsabilidad de EL PRESTADOR se limita al importe de este encargo.",
        ],
      },
      {
        title: "Cancelación",
        body: [
          "Si EL CLIENTE cancela el encargo después de empezada la fabricación, abonará el material consumido y el trabajo realizado hasta ese momento, que podrá descontarse del anticipo. Las piezas fabricadas a medida no se pueden devolver por desistimiento (artículo 103.c del Real Decreto Legislativo 1/2007).",
        ],
      },
      {
        title: "Confidencialidad",
        body: [
          "EL PRESTADOR no compartirá con terceros ni reutilizará los archivos y la información técnica de EL CLIENTE, y no fabricará copias adicionales sin su permiso. Podrá conservar copia de los archivos el tiempo necesario para atender la garantía y reposiciones.",
        ],
      },
      DATA_CLAUSE,
      LAW_CLAUSE,
    ],
  },
  {
    slug: "diseno-cesion-derechos",
    title: "Contrato de diseño 3D y cesión de derechos",
    summary: "Encargo de modelado: entregables, revisiones, precio y cesión de los derechos de explotación del diseño.",
    parties: true,
    providerRole: "EL DISEÑADOR",
    clientRole: "EL CLIENTE",
    fields: [
      { key: "objeto", label: "Diseño encargado", placeholder: "[Descripción del diseño]", type: "textarea" },
      { key: "entregables", label: "Entregables", placeholder: "[Formatos de entrega]", default: "Archivos STL y STEP del modelo final, y una pieza impresa de muestra" },
      { key: "revisiones", label: "Rondas de cambios incluidas", placeholder: "[Número de revisiones]", type: "number", default: "2" },
      { key: "precio", label: "Precio total (IVA incluido)", placeholder: "[Precio total]" },
      { key: "plazo", label: "Plazo de entrega", placeholder: "[Plazo]", default: "20 días hábiles desde la firma" },
      { key: "cesion", label: "Alcance de la cesión", placeholder: "[Exclusiva o no exclusiva]", default: "en exclusiva, para todo el mundo y por el plazo máximo que permite la ley" },
      JURISDICTION_FIELD,
    ],
    recitals: [
      "Que EL DISEÑADOR se dedica profesionalmente al modelado y diseño de piezas para impresión 3D.",
      "Que EL CLIENTE desea encargarle el diseño descrito en este contrato y adquirir los derechos necesarios para explotarlo, y ambas partes lo acuerdan con arreglo a las siguientes cláusulas.",
    ],
    clauses: [
      { title: "Objeto", body: ["EL DISEÑADOR realizará el siguiente diseño: {{campo.objeto}}", "Entregables: {{campo.entregables}}."] },
      {
        title: "Desarrollo y revisiones",
        body: [
          "EL DISEÑADOR presentará una propuesta y el precio incluye {{campo.revisiones}} rondas de cambios sobre ella. Los cambios adicionales, o los que alteren lo encargado, se presupuestarán aparte. EL CLIENTE responderá a cada propuesta en un plazo razonable; su silencio durante más de 15 días naturales equivaldrá a la aprobación.",
        ],
      },
      { title: "Precio y pago", body: ["El precio es de {{campo.precio}}, impuestos incluidos: el 50 % al firmar y el 50 % a la entrega de los archivos finales, salvo otro acuerdo por escrito.", "Plazo de entrega: {{campo.plazo}}."] },
      {
        title: "Cesión de derechos",
        body: [
          "Una vez pagado el precio completo, EL DISEÑADOR cede a EL CLIENTE, {{campo.cesion}}, los derechos de explotación del diseño final: reproducción (incluida la fabricación por impresión 3D o cualquier otro procedimiento), distribución, comunicación pública y transformación, conforme a los artículos 43 y siguientes del Real Decreto Legislativo 1/1996 (Ley de Propiedad Intelectual).",
          "Hasta el pago completo, EL CLIENTE solo podrá usar las propuestas para evaluarlas. Los bocetos, versiones descartadas, archivos de trabajo y herramientas propias de EL DISEÑADOR no forman parte de la cesión.",
          "EL DISEÑADOR conserva los derechos morales que la ley le reconoce y podrá mostrar el diseño en su portafolio, salvo que EL CLIENTE lo prohíba por escrito por motivos de confidencialidad.",
        ],
      },
      {
        title: "Garantías",
        body: [
          "EL DISEÑADOR garantiza que el diseño es original y que no infringe derechos de terceros. EL CLIENTE garantiza que tiene derecho a usar las marcas, imágenes y referencias que aporte para el encargo.",
        ],
      },
      {
        title: "Confidencialidad",
        body: ["Ambas partes mantendrán en secreto la información técnica y comercial que se intercambien con motivo de este encargo, durante su vigencia y dos años después."],
      },
      DATA_CLAUSE,
      LAW_CLAUSE,
    ],
  },
  {
    slug: "confidencialidad",
    title: "Acuerdo de confidencialidad (NDA)",
    summary: "Para recibir diseños, prototipos o información técnica antes de presupuestar o fabricar.",
    parties: true,
    providerRole: "EL PRESTADOR",
    clientRole: "EL CLIENTE",
    fields: [
      { key: "finalidad", label: "Finalidad", placeholder: "[Finalidad del intercambio]", type: "textarea", default: "Estudiar, presupuestar y, en su caso, fabricar piezas mediante impresión 3D a partir de los diseños de EL CLIENTE." },
      { key: "duracion", label: "Años de confidencialidad", placeholder: "[Número de años]", type: "number", default: "3" },
      JURISDICTION_FIELD,
    ],
    recitals: [
      "Que las partes van a intercambiar información con la siguiente finalidad: {{campo.finalidad}}",
      "Que parte de esa información es confidencial y ambas desean protegerla con arreglo a las siguientes cláusulas.",
    ],
    clauses: [
      {
        title: "Información confidencial",
        body: [
          "Es confidencial toda la información que una parte comunique a la otra con motivo de la finalidad indicada, en cualquier formato: archivos de diseño, planos, prototipos, piezas, muestras, precios, clientes, procesos y conocimientos técnicos.",
          "No lo es la información que ya fuera pública, que la parte receptora conociera antes de forma lícita, que reciba de un tercero sin obligación de secreto o que desarrolle de manera independiente.",
        ],
      },
      {
        title: "Obligaciones",
        body: [
          "La parte receptora usará la información solo para la finalidad indicada, la protegerá con la misma diligencia que la suya propia y solo la compartirá con empleados o colaboradores que la necesiten y estén obligados a guardar el mismo secreto.",
          "En particular, no fabricará más piezas de las encargadas, destruirá las piezas fallidas y de prueba que reproduzcan diseños de la otra parte y no subirá los archivos a repositorios, servicios de impresión ni plataformas de terceros sin permiso.",
        ],
      },
      { title: "Duración", body: ["Estas obligaciones duran {{campo.duracion}} años desde la firma, y se mantienen aunque las partes no lleguen a contratar."] },
      {
        title: "Devolución y destrucción",
        body: ["Cuando la otra parte lo pida, o al terminar la colaboración, la parte receptora devolverá o borrará la información confidencial y sus copias, salvo lo que deba conservar por obligación legal."],
      },
      { title: "Sin cesión de derechos", body: ["Este acuerdo no transmite ninguna licencia ni derecho de propiedad intelectual o industrial sobre la información intercambiada, ni obliga a ninguna parte a contratar."] },
      { title: "Incumplimiento", body: ["La parte que incumpla este acuerdo indemnizará a la otra por los daños y perjuicios que le cause, sin perjuicio de las demás acciones legales que procedan."] },
      DATA_CLAUSE,
      LAW_CLAUSE,
    ],
  },
  {
    slug: "condiciones-venta",
    title: "Condiciones generales de venta",
    summary: "Para la tienda online o los encargos de particulares: pedidos, plazos, envíos, desistimiento y garantía.",
    parties: false,
    providerRole: "el vendedor",
    clientRole: "el cliente",
    fields: [
      { key: "web", label: "Web o canal de venta", placeholder: "[Web de la tienda]" },
      { key: "produccion", label: "Plazo habitual de producción", placeholder: "[Plazo de producción]", default: "de 3 a 7 días hábiles" },
      { key: "envio", label: "Envíos", placeholder: "[Zonas y plazos de envío]", type: "textarea", default: "Enviamos a la Península y Baleares por mensajería en 24-72 horas desde que el pedido sale del taller. El coste se indica antes de pagar." },
      { key: "devolucion", label: "Coste de devolución", placeholder: "[Quién paga la devolución]", default: "a cargo del cliente" },
    ],
    recitals: [
      "Estas condiciones regulan las compras de productos y los encargos realizados a {{empresa.nombre}} (en adelante, «el vendedor»), con NIF {{empresa.nif}} y domicilio en {{empresa.domicilio}}, a través de {{campo.web}} o de cualquier otro canal de venta. Correo de contacto: {{empresa.email}}.",
      "Al realizar un pedido, el cliente declara haberlas leído y aceptarlas.",
    ],
    clauses: [
      {
        title: "Pedidos y presupuestos",
        body: [
          "El pedido se considera realizado cuando el cliente completa el pago o acepta por escrito un presupuesto. Los presupuestos son válidos durante el plazo que indiquen. El vendedor confirmará cada pedido por correo electrónico.",
        ],
      },
      { title: "Precios y pago", body: ["Los precios se indican en euros e incluyen el IVA. Los gastos de envío se muestran por separado antes de pagar. Se aceptan los medios de pago que figuran en el proceso de compra."] },
      {
        title: "Fabricación y plazos",
        body: [
          "La mayoría de productos se fabrican bajo pedido. El plazo habitual de producción es {{campo.produccion}}, al que se suma el de envío. En encargos personalizados se acordará un plazo concreto en el presupuesto.",
        ],
      },
      { title: "Envío", body: ["{{campo.envio}}", "El cliente debe revisar el paquete al recibirlo y comunicar cualquier daño de transporte en un plazo de 48 horas, con fotografías si es posible."] },
      {
        title: "Derecho de desistimiento",
        body: [
          "El cliente que sea consumidor puede desistir de la compra sin indicar el motivo en un plazo de 14 días naturales desde la entrega, comunicándolo por escrito al correo de contacto. El vendedor devolverá el importe pagado, incluido el envío estándar, en un plazo máximo de 14 días desde que reciba el producto. Los gastos de devolución corren {{campo.devolucion}}.",
          "No hay derecho de desistimiento en los productos confeccionados según las especificaciones del cliente o claramente personalizados (artículo 103.c del Real Decreto Legislativo 1/2007), como piezas a medida, diseños propios del cliente, colores o textos personalizados.",
        ],
      },
      {
        title: "Garantía",
        body: [
          "Los productos tienen la garantía legal de conformidad de tres años desde la entrega. Si un producto presenta un defecto, el cliente podrá pedir su reparación o sustitución y, cuando no sean posibles, la rebaja del precio o la devolución del importe.",
          "Las piezas impresas en 3D muestran líneas de capa y pequeñas variaciones de color y acabado propias del proceso, que no se consideran defectos. La garantía no cubre el desgaste normal ni el uso del producto fuera de las condiciones indicadas.",
        ],
      },
      {
        title: "Diseños del cliente",
        body: [
          "Cuando el cliente encargue la fabricación de un diseño propio, garantiza que tiene derecho a reproducirlo. El vendedor podrá rechazar encargos que infrinjan derechos de terceros o que sirvan para fabricar objetos ilícitos o peligrosos.",
        ],
      },
      DATA_CLAUSE,
      {
        title: "Ley aplicable y reclamaciones",
        body: [
          "Estas condiciones se rigen por la ley española. El cliente puede dirigir sus reclamaciones al correo de contacto y solicitar hojas de reclamaciones. Para las controversias con consumidores serán competentes los juzgados de su domicilio.",
        ],
      },
    ],
  },
];

export function getContractTemplate(slug: string): ContractTemplate | undefined {
  return CONTRACT_TEMPLATES.find((t) => t.slug === slug);
}

/** Sustituye los huecos `{{…}}` por sus valores; los que falten quedan como línea para rellenar a mano. */
export function fillPlaceholders(text: string, values: Record<string, string | null | undefined>, blank = "________________"): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = values[key];
    return v && v.trim() ? v.trim() : blank;
  });
}

const ORDINALS = ["Primera", "Segunda", "Tercera", "Cuarta", "Quinta", "Sexta", "Séptima", "Octava", "Novena", "Décima", "Undécima", "Duodécima", "Decimotercera", "Decimocuarta", "Decimoquinta"];

export interface BuiltContract {
  title: string;
  /** Lugar y fecha. */
  dateLine: string;
  sections: Array<{ heading: string | null; paragraphs: Array<{ lead?: string; text: string }> }>;
  /** Pie de firma de cada parte, o null si no lleva firmas. */
  signatures: Array<{ role: string; name: string }> | null;
}

/** Monta el texto completo del contrato con los valores dados (los huecos vacíos quedan con `blank`). */
export function buildContract(t: ContractTemplate, values: Record<string, string | null | undefined>, blank?: string): BuiltContract {
  const fill = (s: string) => fillPlaceholders(s, values, blank);
  const sections: BuiltContract["sections"] = [];
  if (t.parties) {
    sections.push({
      heading: "Reunidos",
      paragraphs: [
        { text: fill(`De una parte, {{empresa.nombre}}, con NIF {{empresa.nif}} y domicilio en {{empresa.domicilio}} (en adelante, ${t.providerRole}).`) },
        { text: fill(`De otra parte, {{cliente.nombre}}, con NIF {{cliente.nif}} y domicilio en {{cliente.domicilio}} (en adelante, ${t.clientRole}).`) },
        { text: "Ambas partes se reconocen capacidad legal suficiente para obligarse y, a tal efecto," },
      ],
    });
    sections.push({ heading: "Exponen", paragraphs: t.recitals.map((r, i) => ({ lead: `${["I", "II", "III", "IV", "V"][i] ?? i + 1}.`, text: fill(r) })) });
    sections.push({ heading: "Cláusulas", paragraphs: [] });
  } else {
    sections.push({ heading: null, paragraphs: t.recitals.map((r) => ({ text: fill(r) })) });
  }
  t.clauses.forEach((c, i) => {
    const heading = t.parties ? `${ORDINALS[i] ?? i + 1}. ${c.title}` : `${i + 1}. ${c.title}`;
    sections.push({ heading, paragraphs: c.body.map((p) => ({ text: fill(p) })) });
  });
  const dateLine = t.parties ? fill("En {{lugar}}, a {{fecha}}.") : fill("Última actualización: {{fecha}}.");
  if (t.parties) sections.push({ heading: null, paragraphs: [{ text: "Y en prueba de conformidad, las partes firman este contrato por duplicado en el lugar y la fecha indicados." }] });
  return {
    title: t.title,
    dateLine,
    sections,
    signatures: t.parties
      ? [
          { role: t.providerRole, name: fill("{{empresa.nombre}}") },
          { role: t.clientRole, name: fill("{{cliente.nombre}}") },
        ]
      : null,
  };
}
