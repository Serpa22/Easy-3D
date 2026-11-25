import { and, asc, eq, gte, lte } from "drizzle-orm";
import { netOfVat } from "@/lib/costing";
import { isISODate, todayISO } from "@/lib/dates";
import { PAYMENT_METHOD_LABELS, TRANSACTION_SOURCE_LABELS, TRANSACTION_TYPE_LABELS, categoryLabel } from "@/lib/domain";
import { requireCompany } from "@/server/context";
import { transactions } from "@/server/db/schema";

export const dynamic = "force-dynamic";

/** Celda CSV: comillas dobles escapadas y neutralización de fórmulas de hoja de cálculo. */
function cell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const date = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Movimientos de la sub-empresa en CSV (punto y coma, coma decimal, UTF-8 con BOM para Excel). */
export async function GET(request: Request, { params }: { params: Promise<{ company: string }> }) {
  const { company, db, org } = await requireCompany((await params).company);
  const url = new URL(request.url);
  const today = todayISO(org.timeZone);
  const fromParam = url.searchParams.get("desde");
  const toParam = url.searchParams.get("hasta");
  const from = isISODate(fromParam) ? fromParam : `${today.slice(0, 4)}-01-01`;
  const to = isISODate(toParam) ? toParam : today;

  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.companyId, company.id), gte(transactions.date, from), lte(transactions.date, to)))
    .orderBy(asc(transactions.date), asc(transactions.createdAt));

  const header = ["Fecha", "Tipo", "Categoría", "Concepto", "Proveedor/Cliente", "Importe", "IVA %", "Base imponible", "Cuota IVA", "Método de pago", "Origen", "Notas"];
  const lines = [header.map(cell).join(";")];
  for (const t of rows) {
    const sign = t.type === "income" ? 1 : -1;
    const net = netOfVat(t.amountCents, t.vatRatePct);
    lines.push(
      [
        cell(date(t.date)),
        cell(TRANSACTION_TYPE_LABELS[t.type]),
        cell(categoryLabel(t.category)),
        cell(t.description),
        cell(t.counterparty),
        money(sign * t.amountCents),
        String(t.vatRatePct).replace(".", ","),
        money(sign * net),
        money(sign * (t.amountCents - net)),
        cell(t.paymentMethod ? PAYMENT_METHOD_LABELS[t.paymentMethod] : ""),
        cell(TRANSACTION_SOURCE_LABELS[t.sourceType]),
        cell(t.notes),
      ].join(";"),
    );
  }
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="easy3d-${company.slug}-movimientos-${from}_${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
