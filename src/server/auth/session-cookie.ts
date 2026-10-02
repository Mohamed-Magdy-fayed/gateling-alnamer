import { SESSION_COOKIE_REFRESH_MS, SESSION_TTL_MS } from "@/server/config/policy";

/** Host-only: the `__Host-` prefix forces Secure, Path=/ and no Domain. */
export const SESSION_COOKIE = "__Host-session";
/** Pre-`__Host-` name: never read or written, only deleted when a browser still holds it. */
export const LEGACY_SESSION_COOKIE = "alnamer_session";
/** Not a secret: when the proxy last re-issued the session cookie (ms since epoch). */
export const SESSION_REFRESHED_COOKIE = "__Host-session-refreshed";

export type CookieOptions = {
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: "/";
  expires?: Date;
  maxAge?: number;
};

/** Always `secure: true`: browsers refuse a `__Host-` cookie without it (localhost counts as secure). */
export function sessionCookieOptions(expires: Date): CookieOptions {
  return { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires };
}

/** Attributes for a deletion; a browser only accepts a `__Host-` Set-Cookie that still says Secure. */
export function clearedCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  };
}

export type CookieReader = { get(name: string): { value: string } | undefined };

/** The token to look up: `__Host-session` only. */
export function readSessionToken(store: CookieReader): string | null {
  return store.get(SESSION_COOKIE)?.value || null;
}

export type CookieWrite = {
  name: string;
  value: string;
  options: CookieOptions;
};

/**
 * Cookie writes the proxy makes for a page request. No DB access: the cookie only carries the token,
 * the database stays the authority on expiry. Deletes a leftover legacy cookie and re-issues
 * `__Host-session` at most once a day to keep the cookie lifetime sliding with the session.
 */
export function planSessionCookies(store: CookieReader, now: Date): CookieWrite[] {
  const writes: CookieWrite[] = [];
  const legacy = store.get(LEGACY_SESSION_COOKIE)?.value;
  const current = store.get(SESSION_COOKIE)?.value;
  const expires = new Date(now.getTime() + SESSION_TTL_MS);

  if (legacy) {
    writes.push({ name: LEGACY_SESSION_COOKIE, value: "", options: clearedCookieOptions() });
  }

  const token = current;
  if (!token) return writes;

  const refreshedAt = Number(store.get(SESSION_REFRESHED_COOKIE)?.value);
  const due =
    !Number.isFinite(refreshedAt) || now.getTime() - refreshedAt >= SESSION_COOKIE_REFRESH_MS;
  if (due) {
    writes.push({ name: SESSION_COOKIE, value: token, options: sessionCookieOptions(expires) });
    writes.push({
      name: SESSION_REFRESHED_COOKIE,
      value: String(now.getTime()),
      options: sessionCookieOptions(expires),
    });
  }
  return writes;
}
