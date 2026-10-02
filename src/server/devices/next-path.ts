const FALLBACK = "/dashboard";

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
 * single "/" and carry no backslash or control character. Anything else, or a missing value,
 * falls back to the dashboard.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//") || hasUnsafeChar(value)) return FALLBACK;
  return value;
}
