import { type NextRequest, NextResponse } from "next/server";
import { isLocale, LOCALE_COOKIE, LOCALE_MAX_AGE } from "@/i18n/config";

/** `?lang=ar|en` sets the locale cookie and redirects to the same URL without `lang`. */
export function proxy(request: NextRequest) {
  const lang = request.nextUrl.searchParams.get("lang") ?? undefined;
  if (!isLocale(lang)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.searchParams.delete("lang");
  const response = NextResponse.redirect(url, 307);
  response.cookies.set(LOCALE_COOKIE, lang, {
    path: "/",
    maxAge: LOCALE_MAX_AGE,
    sameSite: "lax",
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
