import "server-only";
import { parseServerEnv, type ServerEnv } from "./env-schema";

export type { ServerEnv };

let cached: ServerEnv | undefined;

/** Validated lazily and cached. Errors name keys, never values (see env-schema.ts). */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

export function isDeployed(): boolean {
  return serverEnv().VERCEL_ENV === "preview" || serverEnv().VERCEL_ENV === "production";
}
