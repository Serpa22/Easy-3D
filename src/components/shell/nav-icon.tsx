import { Cylinder, Layers, LayoutDashboard, Package, Printer, Settings, ShoppingBag, Truck, Users, Wallet, Zap } from "lucide-react";
import type { NavItem } from "@/lib/nav";

const ICONS: Record<NavItem["icon"], typeof Wallet> = {
  dashboard: LayoutDashboard,
  finance: Wallet,
  orders: ShoppingBag,
  shipments: Truck,
  customers: Users,
  products: Package,
  machines: Printer,
  prints: Layers,
  materials: Cylinder,
  energy: Zap,
  settings: Settings,
};

export function NavIcon({ name, className }: { name: NavItem["icon"]; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden="true" />;
}
