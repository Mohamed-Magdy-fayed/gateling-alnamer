type HeaderReader = { get(name: string): string | null };

/**
 * The client IP for rate limiting. Both forwarding headers are client-controlled unless a proxy we
 * run overwrites them, so neither is trusted by default (a spoofed header would pick its own
 * bucket): `x-forwarded-for`'s first entry only behind Vercel's edge (VERCEL=1), `x-real-ip` only
 * when TRUST_PROXY_HEADERS=1 (the smoke run, or a reverse proxy that sets it), else "local".
 */
export function clientIp(
  headers: HeaderReader,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (env.VERCEL === "1") {
    const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (first) return first;
  }
  if (env.TRUST_PROXY_HEADERS === "1") {
    const real = headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  return "local";
}
