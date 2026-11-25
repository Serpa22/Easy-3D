/** Ajustes globales de la organización (tabla `app_settings`). */
import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { appSettings } from "@/server/db/schema";
import { DEFAULT_TIME_ZONE } from "@/lib/format";

export interface OrgSettings {
  /** Nombre del grupo / empresa matriz. */
  orgName: string;
  /** Zona horaria IANA para fechas contables y tarifas eléctricas. */
  timeZone: string;
}

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  orgName: "Easy 3D",
  timeZone: DEFAULT_TIME_ZONE,
};

const ORG_KEY = "org";

export const getOrgSettings = cache(async (): Promise<OrgSettings> => {
  const db = await getDb();
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, ORG_KEY)).limit(1);
  return { ...DEFAULT_ORG_SETTINGS, ...((rows[0]?.value as Partial<OrgSettings> | undefined) ?? {}) };
});

export async function saveOrgSettings(patch: Partial<OrgSettings>): Promise<OrgSettings> {
  const db = await getDb();
  const current = await getOrgSettings();
  const next = { ...current, ...patch };
  await db
    .insert(appSettings)
    .values({ key: ORG_KEY, value: next })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
  return next;
}
