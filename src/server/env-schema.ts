import { z } from "zod";

/**
 * Pure environment schema: no `server-only`, no Next imports, so build, boot and tests share it.
 * Every message names the key and why; it never contains a value.
 */

export class EnvError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid server environment:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
    this.name = "EnvError";
  }
}

const blankAsUnset = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = z.preprocess(blankAsUnset, z.string().min(1).optional());

const schema = z.object({
  APP_MODE: z.preprocess(blankAsUnset, z.enum(["demo", "live"])),
  DATABASE_URL: z.preprocess(blankAsUnset, z.string().min(1)),
  VERCEL: optionalText,
  VERCEL_ENV: z.preprocess(
    blankAsUnset,
    z.enum(["development", "preview", "production"]).optional(),
  ),
  BASE_URL: z.preprocess(blankAsUnset, z.url().optional()),
  DEMO_HOSTS: optionalText,
  DEMO_ACCOUNTS_PASSWORD: optionalText,
  DEMO_TOTP_SECRET: optionalText,
  INNGEST_DEV: optionalText,
  MYFATOORAH_LIVE: optionalText,
  MYFATOORAH_API_KEY: optionalText,
  BUNNY_STREAM_API_KEY: optionalText,
  FIREBASE_SERVICE_ACCOUNT: optionalText,
  SMTP_HOST: optionalText,
  SMTP_PORT: z.preprocess(blankAsUnset, z.coerce.number().int().positive().optional()),
  SMTP_USER: optionalText,
  SMTP_PASSWORD: optionalText,
  SMTP_FROM_EMAIL: z.preprocess(blankAsUnset, z.email().optional()),
  SMTP_FROM_NAME: optionalText,
});

export type ServerEnv = z.infer<typeof schema>;

type Source = Record<string, string | undefined>;

const FIX_HINT = "set it in .env (local) or the Vercel project environment variables";

function shapeProblems(source: Source): string[] {
  const parsed = schema.safeParse(source);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const key = issue.path.join(".") || "environment";
    if (key === "APP_MODE") {
      return `APP_MODE must be "demo" or "live" and has no default; ${FIX_HINT}.`;
    }
    return `${key} is missing or malformed; ${FIX_HINT}.`;
  });
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function demoProblems(env: ServerEnv): string[] {
  const problems: string[] = [];
  if (isTrue(env.MYFATOORAH_LIVE) && env.MYFATOORAH_API_KEY) {
    problems.push(
      "MYFATOORAH_API_KEY is a live credential (MYFATOORAH_LIVE=true) and is refused when APP_MODE=demo; unset it or use a test key.",
    );
  }
  if (env.BUNNY_STREAM_API_KEY) {
    problems.push(
      "BUNNY_STREAM_API_KEY is a live credential and is refused when APP_MODE=demo; unset it.",
    );
  }
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    problems.push(
      "FIREBASE_SERVICE_ACCOUNT is a live credential and is refused when APP_MODE=demo; unset it.",
    );
  }
  if (env.VERCEL_ENV === "production") {
    const allowed = (env.DEMO_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    const host = hostOf(env.BASE_URL);
    if (!host || !allowed.includes(host)) {
      problems.push(
        "DEMO_HOSTS must list the BASE_URL host when APP_MODE=demo runs with VERCEL_ENV=production; add the host or switch to APP_MODE=live.",
      );
    }
  }
  return problems;
}

function crossProblems(env: ServerEnv): string[] {
  const problems: string[] = [];
  const deployed = env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "production";
  if (deployed && !env.BASE_URL) {
    problems.push(`BASE_URL is required when VERCEL_ENV=${env.VERCEL_ENV}; ${FIX_HINT}.`);
  }
  if (env.INNGEST_DEV && env.VERCEL) {
    problems.push(
      "INNGEST_DEV must not be set on Vercel (it points Inngest at a local dev server); unset it.",
    );
  }
  if (env.APP_MODE === "demo") problems.push(...demoProblems(env));
  if (env.APP_MODE === "live" && env.DEMO_ACCOUNTS_PASSWORD) {
    problems.push("DEMO_ACCOUNTS_PASSWORD is refused when APP_MODE=live; unset it.");
  }
  return problems;
}

/** Validates an environment source; throws `EnvError` listing key names only. */
export function parseServerEnv(source: Source): ServerEnv {
  const shape = shapeProblems(source);
  if (shape.length > 0) throw new EnvError(shape);
  const env = schema.parse(source);
  const problems = crossProblems(env);
  if (problems.length > 0) throw new EnvError(problems);
  return env;
}
