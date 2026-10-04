// The page Content Security Policy (F5b). Built per request by the proxy with a fresh nonce; shipped
// report-only until H1 switches it to enforce (`CSP_ENFORCE`).

/** Report-only until H1: the proxy sends `Content-Security-Policy-Report-Only` while this is false. */
export const CSP_ENFORCE = false;

export const CSP_REPORT_PATH = "/api/csp-report";

const TURNSTILE = "https://challenges.cloudflare.com";

export type CspOptions = {
  nonce: string;
  /** `next dev`: React and HMR need eval and a websocket. */
  development: boolean;
  /** Only an https page asks the browser to upgrade sub-requests. */
  https: boolean;
  /** The browser Sentry DSN, when set: its ingest origin is allowed in connect-src. */
  sentryDsn?: string;
};

/** The ingest origin of a Sentry DSN (`https://<key>@o1.ingest.sentry.io/2` -> its origin), or null. */
export function sentryOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function buildCsp(options: CspOptions): string {
  const { nonce, development, https } = options;
  const sentry = sentryOrigin(options.sentryDsn);
  const directives: Array<[string, ...string[]]> = [
    ["default-src", "'self'"],
    [
      "script-src",
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      TURNSTILE,
      ...(development ? ["'unsafe-eval'"] : []),
    ],
    // Inline style attributes (React style props) and next/font need it; nonce-only styles do not
    // work with React. Scripts are the injection risk the nonce closes.
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:"],
    ["font-src", "'self'"],
    ["media-src", "'self'", "blob:"],
    ["connect-src", "'self'", ...(sentry ? [sentry] : []), ...(development ? ["ws:"] : [])],
    ["frame-src", "'self'", TURNSTILE],
    ["frame-ancestors", "'none'"],
    ["form-action", "'self'"],
    ["base-uri", "'self'"],
    ["object-src", "'none'"],
    ["worker-src", "'self'", "blob:"],
    ["report-uri", CSP_REPORT_PATH],
  ];
  if (https) directives.push(["upgrade-insecure-requests"]);
  return directives.map((parts) => parts.join(" ")).join("; ");
}

/** A fresh nonce: 16 random bytes, base64 (Web Crypto, so it runs in the proxy too). */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The response header name for the current mode. */
export const cspHeaderName = (enforce: boolean = CSP_ENFORCE): string =>
  enforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
