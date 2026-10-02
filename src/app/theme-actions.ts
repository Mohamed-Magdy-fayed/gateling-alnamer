"use server";

import { cookies } from "next/headers";
import { isTheme, THEME_COOKIE, THEME_MAX_AGE } from "@/lib/theme";

export async function setThemeAction(value: string): Promise<void> {
  if (!isTheme(value)) return;
  (await cookies()).set(THEME_COOKIE, value, {
    path: "/",
    maxAge: THEME_MAX_AGE,
    sameSite: "lax",
  });
}
