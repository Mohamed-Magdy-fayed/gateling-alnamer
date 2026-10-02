type HeaderReader = { get(name: string): string | null };

/**
 * The client IP for rate limiting. `x-forwarded-for` is client-controlled everywhere except behind
 * Vercel's edge, so its first entry is trusted only when VERCEL=1; otherwise `x-real-ip`, else "local".
 */
export function clientIp(
  headers: HeaderReader,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (env.VERCEL === "1") {
    const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "local";
}
