import { sentryOptions } from "@/lib/observability/sentry-options";

// Browser errors go to Sentry only when NEXT_PUBLIC_SENTRY_DSN is set at build time (F5b); without
// it the SDK chunk is never loaded. The CSP allows the DSN's ingest origin in connect-src.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init(sentryOptions(dsn, process.env.NEXT_PUBLIC_VERCEL_ENV));
  });
}
