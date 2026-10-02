import { type NextRequest, NextResponse } from "next/server";
import { isLocale, LOCALE_COOKIE, LOCALE_MAX_AGE } from "@/i18n/config";
import { planSessionCookies } from "@/server/auth/session-cookie";
import { clock } from "@/server/clock";

/**
 * Session cookie upkeep that a server component cannot do (it may not write cookies): delete a
 * leftover legacy `alnamer_session` and re-issue the cookie daily. No database access.
 */
function withSessionCookies(request: NextRequest, response: NextResponse): NextResponse {
  for (const { name, value, options } of planSessionCookies(request.cookies, clock.now())) {
    response.cookies.set(name, value, options);
  }
  return response;
}

/** `?lang=ar|en` sets the locale cookie and redirects to the same URL without `lang`. */
export function proxy(request: NextRequest) {
  const lang = request.nextUrl.searchParams.get("lang") ?? undefined;
  if (!isLocale(lang)) return withSessionCookies(request, NextResponse.next());
  const url = request.nextUrl.clone();
  url.searchParams.delete("lang");
  const response = NextResponse.redirect(url, 307);
  response.cookies.set(LOCALE_COOKIE, lang, {
    path: "/",
    maxAge: LOCALE_MAX_AGE,
    sameSite: "lax",
  });
  return withSessionCookies(request, response);
}

export const config = {
  // Skips `_next/`, `api` as a whole segment and root-level files like /favicon.ico; a dotted
  // segment deeper in the path (/courses/node.js) is still a page.
  matcher: ["/((?!_next/|api(?:/|$)|[^/]+\\.[A-Za-z0-9]+$).*)"],
};
