"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { ActionResult, ActionState } from "@/lib/action";
import { DOCUMENT_KIND_LABELS, DOCUMENT_STATUSES } from "@/lib/domain";
import { DEFAULT_DOC_ACCENT } from "@/lib/documents";
import { zDecimal, zInt, zOptionalColor, zOptionalText } from "@/lib/validation";
import { ActionError, parseForm, parseInput, runAction } from "@/server/action";
import { requireCompany } from "@/server/context";
import { companies } from "@/server/db/schema";
import { deleteDocument, documentInputSchema, saveDocument, setQuoteStatus } from "@/server/domain/documents-service";

/** Crea o edita un documento a partir del formulario (JSON tipado, importes como texto). */
export async function saveDocumentAction(slug: string, payload: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const input = parseInput(documentInputSchema, payload);
    const saved = await saveDocument(db, company, input);
    revalidatePath(`/e/${slug}`, "layout");
    const label = DOCUMENT_KIND_LABELS[input.kind];
    const o = input.kind === "quote" || input.kind === "delivery_note" ? "o" : "a";
    return { data: { id: saved.id }, message: input.id ? `${label} ${saved.number} actualizad${o}` : `${label} ${saved.number} emitid${o}` };
  });
}

export async function deleteDocumentAction(slug: string, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    await deleteDocument(db, company.id, parseInput(z.uuid(), id));
    revalidatePath(`/e/${slug}`, "layout");
    redirect(`/e/${slug}/documentos`);
  });
}

export async function setQuoteStatusAction(slug: string, id: string, status: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const next = z.enum(DOCUMENT_STATUSES).parse(status);
    await setQuoteStatus(db, company.id, parseInput(z.uuid(), id), next);
    revalidatePath(`/e/${slug}`, "layout");
    return { message: next === "accepted" ? "Presupuesto aceptado" : next === "rejected" ? "Presupuesto rechazado" : "Presupuesto pendiente de respuesta" };
  });
}

/* --------------------- Datos fiscales y series (Ajustes) --------------------- */

const prefix = () => z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,6}$/, "De 1 a 6 letras, números o guiones");

const billingSchema = z.object({
  legalName: zOptionalText(160),
  taxId: z.preprocess((v) => (typeof v === "string" ? v.replace(/[\s.-]/g, "").toUpperCase() : v), zOptionalText(20)),
  fiscalAddressLine: zOptionalText(200),
  fiscalPostalCode: zOptionalText(20),
  fiscalCity: zOptionalText(80),
  fiscalProvince: zOptionalText(80),
  fiscalCountry: zOptionalText(80),
  contactEmail: z.preprocess((v) => (v === "" ? undefined : v), z.email("Correo no válido").max(160).optional()).transform((v) => v ?? null),
  contactPhone: zOptionalText(40),
  website: zOptionalText(160),
  iban: z
    .preprocess((v) => (typeof v === "string" ? v.replace(/\s/g, "").toUpperCase() : v), zOptionalText(34))
    .refine((v) => v === null || /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v), "IBAN no válido"),
});

export async function saveBillingAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    await db.update(companies).set(parseForm(billingSchema, formData)).where(eq(companies.id, company.id));
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Datos fiscales guardados" };
  });
}

const seriesSchema = z.object({
  invoicePrefix: prefix(),
  rectifyingPrefix: prefix(),
  quotePrefix: prefix(),
  deliveryPrefix: prefix(),
  irpfRatePct: zDecimal({ min: 0, max: 50 }),
  quoteValidityDays: zInt({ min: 1, max: 365 }),
  paymentTermsDays: zInt({ min: 0, max: 365 }),
  quoteTerms: zOptionalText(4000),
  documentFooter: zOptionalText(1000),
  brandColor: zOptionalColor(),
});

export async function saveDocumentSettingsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    const input = parseForm(seriesSchema, formData);
    const prefixes = [input.invoicePrefix, input.rectifyingPrefix, input.quotePrefix, input.deliveryPrefix];
    if (new Set(prefixes).size !== prefixes.length) {
      throw new ActionError("Cada tipo de documento necesita su propia serie.", { rectifyingPrefix: "Las cuatro series deben ser distintas" });
    }
    await db
      .update(companies)
      .set({ ...input, brandColor: input.brandColor ?? DEFAULT_DOC_ACCENT })
      .where(eq(companies.id, company.id));
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Series y textos guardados" };
  });
}
