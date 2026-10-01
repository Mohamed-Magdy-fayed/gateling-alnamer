import { describeProviders, parseServerEnv } from "@/server/env-schema";

/** Fails the server at boot when the environment is invalid; logs the resolved providers once. */
export function register(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  console.info(`[env] ${describeProviders(parseServerEnv(process.env))}`);
}
