const FALLBACK = "/dashboard";
/** Never a sign-in destination: the auth pages bounce a signed-in user, and /api is not a page. */
const BLOCKED_PATH = /^\/(?:sign-in|sign-up|api(?:\/|$))/i;

function hasUnsafeChar(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    // Backslash (browsers read `/\host` as `//host`), control characters and DEL.
    if (char === "\\" || code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * A `next` value that is safe to redirect to: a same-origin relative path. It must start with a
 * single "/" and carry no backslash or control character, and must not be an auth page (`/sign-in*`,
 * `/sign-up*`) or an API route. Anything else, or a missing value,
 * falls back to the dashboard.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//") || hasUnsafeChar(value)) return FALLBACK;
  const pathname = value.split(/[?#]/, 1)[0] ?? value;
  return BLOCKED_PATH.test(pathname) ? FALLBACK : value;
}
