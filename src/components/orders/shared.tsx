import { Badge } from "@/components/ui/display";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, type OrderStatus, type PaymentStatus } from "@/lib/domain";

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const tone = status === "delivered" ? "ok" : status === "cancelled" || status === "returned" ? "neutral" : status === "shipped" ? "solid" : "outline";
  return <Badge tone={tone}>{ORDER_STATUS_LABELS[status]}</Badge>;
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={status === "paid" ? "ok" : status === "refunded" ? "neutral" : "warn"}>{PAYMENT_STATUS_LABELS[status]}</Badge>;
}

/** Siguiente paso natural de un pedido. */
export const NEXT_STATUS: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  pending: { status: "in_production", label: "Pasar a producción" },
  in_production: { status: "ready", label: "Marcar listo para enviar" },
  ready: { status: "shipped", label: "Marcar enviado" },
  shipped: { status: "delivered", label: "Marcar entregado" },
};
