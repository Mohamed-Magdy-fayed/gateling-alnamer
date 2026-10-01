import { parseServerEnv } from "@/server/env-schema";

/** Fails the server at boot when the environment is invalid (APP_MODE, conflicts). */
export function register(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  parseServerEnv(process.env);
}
