"use server";

import { cookies } from "next/headers";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

/** Guarda la preferencia de tema (oscuro / claro) en una cookie de un año. */
export async function setThemeAction(theme: Theme): Promise<void> {
  const jar = await cookies();
  jar.set(THEME_COOKIE, theme === "light" ? "light" : "dark", {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
