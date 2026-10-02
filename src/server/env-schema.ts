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

const SELECTORS = {
  PAYMENT_PROVIDER: ["mock", "myfatoorah"],
  VIDEO_PROVIDER: ["mock", "sample", "bunny"],
  STORAGE_DRIVER: ["local", "firebase"],
  EMAIL_TRANSPORT: ["smtp", "mailpit"],
  JOBS_MODE: ["inline", "inngest-dev", "inngest"],
} as const;

const selector = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(blankAsUnset, z.enum(values).optional());

const schema = z.object({
  APP_MODE: z.preprocess(blankAsUnset, z.enum(["demo", "live"])),
  PAYMENT_PROVIDER: selector(SELECTORS.PAYMENT_PROVIDER),
  VIDEO_PROVIDER: selector(SELECTORS.VIDEO_PROVIDER),
  STORAGE_DRIVER: selector(SELECTORS.STORAGE_DRIVER),
  EMAIL_TRANSPORT: selector(SELECTORS.EMAIL_TRANSPORT),
  JOBS_MODE: selector(SELECTORS.JOBS_MODE),
  INNGEST_EVENT_KEY: optionalText,
  INNGEST_SIGNING_KEY: optionalText,
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
  UPSTASH_REDIS_REST_URL: optionalText,
  UPSTASH_REDIS_REST_TOKEN: optionalText,
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

type RawEnv = z.infer<typeof schema>;

/** Provider choices after demo defaults; `emailIsDefault` marks an unset EMAIL_TRANSPORT. */
export type ResolvedProviders = {
  readonly payment: NonNullable<RawEnv["PAYMENT_PROVIDER"]>;
  readonly video: NonNullable<RawEnv["VIDEO_PROVIDER"]>;
  readonly storage: NonNullable<RawEnv["STORAGE_DRIVER"]>;
  readonly email: NonNullable<RawEnv["EMAIL_TRANSPORT"]>;
  readonly emailIsDefault: boolean;
  readonly jobs: NonNullable<RawEnv["JOBS_MODE"]>;
};

export type ServerEnv = RawEnv & { readonly providers: ResolvedProviders };

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
    if (key in SELECTORS) {
      const allowed = SELECTORS[key as keyof typeof SELECTORS].join(", ");
      return `${key} must be one of: ${allowed}; ${FIX_HINT}.`;
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

function hasInngestKeys(env: RawEnv): boolean {
  return Boolean(env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY);
}

/** Demo defaults per the F1 plan; in live nothing is defaulted (see `selectorProblems`). */
function resolveProviders(env: RawEnv): ResolvedProviders {
  const demoJobs = hasInngestKeys(env) ? "inngest" : env.INNGEST_DEV ? "inngest-dev" : "inline";
  return {
    payment: env.PAYMENT_PROVIDER ?? "mock",
    video: env.VIDEO_PROVIDER ?? "mock",
    storage: env.STORAGE_DRIVER ?? "local",
    email: env.EMAIL_TRANSPORT ?? (env.SMTP_HOST ? "smtp" : "mailpit"),
    emailIsDefault: env.EMAIL_TRANSPORT === undefined,
    jobs: env.JOBS_MODE ?? demoJobs,
  };
}

const LIVE_SELECTORS = [
  ["PAYMENT_PROVIDER", "myfatoorah"],
  ["VIDEO_PROVIDER", "bunny"],
  ["STORAGE_DRIVER", "firebase"],
  ["EMAIL_TRANSPORT", "smtp"],
  ["JOBS_MODE", "inngest"],
] as const;

function liveSelectorProblems(env: RawEnv): string[] {
  return LIVE_SELECTORS.flatMap(([key, real]) => {
    const value = env[key];
    if (value === undefined) {
      return [`${key} must be set explicitly to "${real}" when APP_MODE=live; ${FIX_HINT}.`];
    }
    if (value !== real) {
      return [`${key} must be "${real}" when APP_MODE=live (a mock or local choice is refused).`];
    }
    return [];
  });
}

function selectorProblems(env: RawEnv, providers: ResolvedProviders): string[] {
  const problems = env.APP_MODE === "live" ? liveSelectorProblems(env) : [];
  if (providers.email === "smtp" && !env.SMTP_HOST) {
    problems.push(`SMTP_HOST is required when EMAIL_TRANSPORT=smtp; ${FIX_HINT}.`);
  }
  const needsInngestKeys = providers.jobs === "inngest" || env.APP_MODE === "live";
  if (needsInngestKeys) {
    for (const key of ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"] as const) {
      if (!env[key]) {
        problems.push(`${key} is required when JOBS_MODE=inngest or APP_MODE=live; ${FIX_HINT}.`);
      }
    }
  }
  return problems;
}

function demoProblems(env: RawEnv): string[] {
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

function redisProblems(env: RawEnv): string[] {
  if (env.APP_MODE !== "live") return [];
  return (["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const)
    .filter((key) => !env[key])
    .map((key) => `${key} is required when APP_MODE=live; ${FIX_HINT}.`);
}

function crossProblems(env: RawEnv, providers: ResolvedProviders): string[] {
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
  problems.push(...redisProblems(env));
  problems.push(...selectorProblems(env, providers));
  return problems;
}

/** Validates an environment source; throws `EnvError` listing key names only. */
export function parseServerEnv(source: Source): ServerEnv {
  const shape = shapeProblems(source);
  if (shape.length > 0) throw new EnvError(shape);
  const raw = schema.parse(source);
  const providers = resolveProviders(raw);
  const problems = crossProblems(raw, providers);
  if (problems.length > 0) throw new EnvError(problems);
  return { ...raw, providers };
}

/** One boot log line: the mode and resolved choices, names only, no credentials. */
export function describeProviders(env: ServerEnv): string {
  const { payment, video, storage, email, jobs } = env.providers;
  return `APP_MODE=${env.APP_MODE} payment=${payment} video=${video} storage=${storage} email=${email} jobs=${jobs}`;
}
