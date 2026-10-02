"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE, LOCALE_MAX_AGE } from "./config";

export async function setLocaleAction(formData: FormData): Promise<void> {
  const value = formData.get("locale");
  if (typeof value !== "string" || !isLocale(value)) return;
  (await cookies()).set(LOCALE_COOKIE, value, {
    path: "/",
    maxAge: LOCALE_MAX_AGE,
    sameSite: "lax",
  });
}
