import "server-only";
import { cookies } from "next/headers";
import { ar, type Dictionary } from "./ar";
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "./config";
import { en } from "./en";

const dictionaries: Record<Locale, Dictionary> = { ar, en };

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : defaultLocale;
}

export async function getDictionary(): Promise<{ t: Dictionary; locale: Locale }> {
  const locale = await getLocale();
  return { t: dictionaries[locale], locale };
}
