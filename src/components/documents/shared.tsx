import { FileText, Plus, Receipt, ReceiptText, Truck } from "lucide-react";
import { ActionsMenu } from "@/components/ui/actions";
import { Badge } from "@/components/ui/display";
import { DOCUMENT_KIND_SLUGS } from "@/lib/documents";
import { DOCUMENT_KIND_LABELS, DOCUMENT_STATUS_LABELS, QUOTE_EXPIRED_LABEL, QUOTE_STATUS_LABELS, type DocumentKind, type DocumentStatus } from "@/lib/domain";

export function DocumentKindBadge({ kind }: { kind: DocumentKind }) {
  return <Badge tone={kind === "rectifying" ? "outline" : "neutral"}>{DOCUMENT_KIND_LABELS[kind]}</Badge>;
}

export function DocumentStatusBadge({ kind, status, dueDate, today }: { kind: DocumentKind; status: DocumentStatus; dueDate: string | null; today: string }) {
  if (kind !== "quote") return <Badge tone="outline">{DOCUMENT_STATUS_LABELS[status]}</Badge>;
  if (status === "issued" && dueDate && dueDate < today) return <Badge tone="neutral">{QUOTE_EXPIRED_LABEL}</Badge>;
  return <Badge tone={status === "accepted" ? "ok" : status === "rejected" ? "neutral" : "warn"}>{QUOTE_STATUS_LABELS[status]}</Badge>;
}

/** Botón «Nuevo documento» con los cuatro tipos (y el pedido de origen, si lo hay). */
export function NewDocumentMenu({ basePath, orderId, variant = "primary", label = "Nuevo documento" }: { basePath: string; orderId?: string; variant?: "primary" | "secondary"; label?: string }) {
  const href = (kind: DocumentKind) => `${basePath}/nuevo?tipo=${DOCUMENT_KIND_SLUGS[kind]}${orderId ? `&pedido=${orderId}` : ""}`;
  return (
    <ActionsMenu
      label={label}
      variant={variant}
      trigger={
        <>
          <Plus aria-hidden="true" />
          {label}
        </>
      }
      items={[
        { type: "link", label: DOCUMENT_KIND_LABELS.invoice, icon: <Receipt />, href: href("invoice") },
        { type: "link", label: DOCUMENT_KIND_LABELS.quote, icon: <FileText />, href: href("quote") },
        { type: "link", label: DOCUMENT_KIND_LABELS.delivery_note, icon: <Truck />, href: href("delivery_note") },
        ...(orderId ? [] : [{ type: "link" as const, label: DOCUMENT_KIND_LABELS.rectifying, icon: <ReceiptText />, href: href("rectifying") }]),
      ]}
    />
  );
}
