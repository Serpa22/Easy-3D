"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult, ActionState } from "@/lib/action";
import { zOptionalText, zText } from "@/lib/validation";
import { parseForm, runAction } from "@/server/action";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { createCompany } from "@/server/domain/companies";

const newCompanySchema = z.object({
  name: zText(80),
  activity: zOptionalText(120),
  description: zOptionalText(500),
});

/** Crea una sub-empresa y entra en ella. */
export async function createCompanyAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await requireUser();
    const input = parseForm(newCompanySchema, formData);
    const db = await getDb();
    const company = await createCompany(db, input);
    revalidatePath("/", "layout");
    redirect(`/e/${company.slug}`);
  });
}
