import { type NextRequest, NextResponse } from "next/server";
import { isLocale, LOCALE_COOKIE, LOCALE_MAX_AGE } from "@/i18n/config";
import { planSessionCookies } from "@/server/auth/session-cookie";
import { clock } from "@/server/clock";
import { buildCsp, cspHeaderName, newNonce } from "@/server/security/csp";

/** The request header that hands the CSP nonce to the render (root layout, Next's own scripts). */
const NONCE_HEADER = "x-nonce";

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

/**
 * A fresh nonce and the page CSP for this request (F5b). The request carries the nonce for the
 * render and the policy itself, from which Next takes the nonce for its own scripts; the response
 * carries the policy (report-only until H1).
 */
function withCsp(request: NextRequest): { csp: string; requestHeaders: Headers } {
  const nonce = newNonce();
  const csp = buildCsp({
    nonce,
    development: process.env.NODE_ENV === "development",
    https:
      request.nextUrl.protocol === "https:" ||
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https",
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  return { csp, requestHeaders };
}

/** `?lang=ar|en` sets the locale cookie and redirects to the same URL without `lang`. */
export function proxy(request: NextRequest) {
  const lang = request.nextUrl.searchParams.get("lang") ?? undefined;
  if (!isLocale(lang)) {
    const { csp, requestHeaders } = withCsp(request);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set(cspHeaderName(), csp);
    return withSessionCookies(request, response);
  }
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
