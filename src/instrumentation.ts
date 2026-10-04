import { sentryOptions } from "@/lib/observability/sentry-options";
import { describeProviders, parseServerEnv } from "@/server/env-schema";

/**
 * Fails the server at boot when the environment is invalid; logs the resolved providers once.
 * Starts Sentry only when SENTRY_DSN is set (F5b); without it the SDK is never loaded.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const env = parseServerEnv(process.env);
  console.info(`[env] ${describeProviders(env)}`);
  if (env.SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init(sentryOptions(env.SENTRY_DSN, env.VERCEL_ENV));
  }
}

/** Server errors in pages, actions and route handlers go to Sentry (no-op without a DSN). */
export async function onRequestError(
  ...args: Parameters<typeof import("@sentry/nextjs").captureRequestError>
): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
}
