/** Secciones de una sub-empresa (barra lateral). `segment` es la ruta bajo /e/<slug>/. */
export interface NavItem {
  segment: string;
  label: string;
  /** Nombre del icono (ver `components/shell/nav-icon`). */
  icon:
    | "dashboard"
    | "finance"
    | "orders"
    | "shipments"
    | "customers"
    | "products"
    | "machines"
    | "prints"
    | "materials"
    | "energy"
    | "settings";
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const COMPANY_NAV: NavGroup[] = [
  {
    title: "Negocio",
    items: [
      { segment: "", label: "Resumen", icon: "dashboard" },
      { segment: "finanzas", label: "Finanzas", icon: "finance" },
      { segment: "pedidos", label: "Pedidos", icon: "orders" },
      { segment: "envios", label: "Envíos", icon: "shipments" },
      { segment: "clientes", label: "Clientes", icon: "customers" },
      { segment: "productos", label: "Productos", icon: "products" },
    ],
  },
  {
    title: "Producción",
    items: [
      { segment: "maquinas", label: "Máquinas", icon: "machines" },
      { segment: "impresiones", label: "Impresiones", icon: "prints" },
      { segment: "materiales", label: "Materiales", icon: "materials" },
      { segment: "energia", label: "Energía", icon: "energy" },
    ],
  },
  {
    title: "Configuración",
    items: [{ segment: "ajustes", label: "Ajustes", icon: "settings" }],
  },
];

export function companyHref(slug: string, segment = ""): string {
  return segment ? `/e/${slug}/${segment}` : `/e/${slug}`;
}
