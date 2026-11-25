"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, ActionState } from "@/lib/action";
import { zId } from "@/lib/validation";
import { parseForm, parseInput, runAction } from "@/server/action";
import { requireCompany } from "@/server/context";
import { editJobSchema, finishJobSchema, finishOpenJob, logFinishedJob, logJobSchema, removeJob, startJobSchema, startManualJob, updateClosedJob } from "@/server/domain/prints-service";

export async function startPrintAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    await startManualJob(db, company.id, parseForm(startJobSchema, formData), new Date());
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Impresión iniciada" };
  });
}

export async function logPrintAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db, org } = await requireCompany(slug);
    await logFinishedJob(db, company.id, parseForm(logJobSchema, formData), org.timeZone, new Date());
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Impresión apuntada" };
  });
}

export async function finishPrintAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db, org } = await requireCompany(slug);
    await finishOpenJob(db, company.id, parseForm(finishJobSchema, formData), org.timeZone, new Date());
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Impresión terminada" };
  });
}

export async function editPrintAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db, org } = await requireCompany(slug);
    await updateClosedJob(db, company.id, parseForm(editJobSchema, formData), org.timeZone);
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Impresión actualizada" };
  });
}

export async function deletePrintAction(slug: string, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company, db } = await requireCompany(slug);
    await removeJob(db, company.id, parseInput(zId(), id));
    revalidatePath(`/e/${slug}`, "layout");
    return { message: "Impresión eliminada" };
  });
}
