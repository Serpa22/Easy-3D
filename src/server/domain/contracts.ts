/** Valores con los que se rellena una plantilla de contrato. */
import "server-only";
import { and, eq } from "drizzle-orm";
import type { SearchParams } from "@/components/ui/nav";
import { isISODate } from "@/lib/dates";
import { partyAddressLines } from "@/lib/documents";
import type { ContractTemplate } from "@/lib/contract-templates";
import { formatDateLong } from "@/lib/format";
import type { DbOrTx } from "@/server/db";
import { customers, type Company, type Customer } from "@/server/db/schema";
import { issuerFromCompany } from "./documents-service";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.slice(0, 2000);

export interface ContractRequest {
  customerId: string | null;
  date: string;
  place: string;
  fields: Record<string, string>;
}

/** Lee el formulario (por URL) de una plantilla; los campos vacíos toman su valor por defecto. */
export function parseContractRequest(t: ContractTemplate, sp: SearchParams, company: Company, today: string): ContractRequest {
  const date = first(sp.fecha);
  const fields: Record<string, string> = {};
  const submitted = first(sp.enviado) === "1";
  for (const f of t.fields) {
    const raw = first(sp[`campo_${f.key}`]);
    // Antes de enviar el formulario se proponen los valores por defecto; después se respeta lo escrito (aunque esté vacío).
    fields[f.key] = submitted ? (raw ?? "") : (raw ?? (f.key === "jurisdiccion" ? (company.fiscalCity ?? "") : (f.key === "web" ? (company.website ?? "") : (f.default ?? ""))));
  }
  const customerId = first(sp.cliente);
  return {
    customerId: customerId && /^[0-9a-f-]{36}$/i.test(customerId) ? customerId : null,
    date: date && isISODate(date) ? date : today,
    place: first(sp.lugar) ?? company.fiscalCity ?? "",
    fields,
  };
}

export async function loadContractCustomer(db: DbOrTx, companyId: string, id: string | null): Promise<Customer | null> {
  if (!id) return null;
  const [c] = await db.select().from(customers).where(and(eq(customers.id, id), eq(customers.companyId, companyId))).limit(1);
  return c ?? null;
}

/** Diccionario `{{clave}}` → valor para `buildContract`. */
export function contractValues(company: Company, customer: Customer | null, req: ContractRequest): Record<string, string | null> {
  const issuer = issuerFromCompany(company);
  const values: Record<string, string | null> = {
    "empresa.nombre": issuer.name,
    "empresa.comercial": company.name,
    "empresa.nif": issuer.taxId,
    "empresa.domicilio": partyAddressLines(issuer).join(", ") || null,
    "empresa.email": issuer.email,
    "empresa.web": issuer.website ?? null,
    "cliente.nombre": customer?.name ?? null,
    "cliente.nif": customer?.taxId ?? null,
    "cliente.domicilio": customer ? partyAddressLines(customer).join(", ") || null : null,
    "cliente.email": customer?.email ?? null,
    lugar: req.place || null,
    fecha: formatDateLong(req.date),
  };
  for (const [k, v] of Object.entries(req.fields)) values[`campo.${k}`] = v;
  return values;
}

/** Query string para reabrir la misma plantilla con los mismos datos (vista previa ↔ impresión). */
export function contractQuery(t: ContractTemplate, req: ContractRequest): string {
  const qs = new URLSearchParams({ enviado: "1", fecha: req.date, lugar: req.place });
  if (req.customerId) qs.set("cliente", req.customerId);
  for (const f of t.fields) qs.set(`campo_${f.key}`, req.fields[f.key] ?? "");
  return qs.toString();
}
