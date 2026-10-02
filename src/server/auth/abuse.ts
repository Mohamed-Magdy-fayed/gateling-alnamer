import { createHash } from "node:crypto";
import { AUTH_LIMITS, type AuthLimits, type LimitRule } from "@/server/config/policy";
import { createRateLimiter, type RateLimiter } from "@/server/rate-limit";
import { type CaptchaVerifier, verifyCaptcha } from "./captcha";

export type { CaptchaVerifier };

/**
 * Abuse guards for the auth actions. Every key is built from hashes (`rl:<action>:ip:<sha256(ip)>`,
 * `rl:<action>:id:<sha256(lower(identifier))>`, `lock:<sha256(identifier)>:<device or sha256(ip)>`),
 * never from a raw email, username or IP. Decisions depend only on those counters, never on whether
 * the account exists, so known and unknown identifiers behave identically.
 */

export type GuardResult =
  | { ok: true }
  | { blocked: "rateLimited" | "locked" | "captchaRequired"; until?: Date };

export type AbuseDeps = {
  readonly limiter?: RateLimiter;
  readonly limits?: AuthLimits;
  readonly verifyCaptcha?: CaptchaVerifier;
};

export type SignInContext = {
  readonly identifier: string;
  readonly ip: string;
  /** The returning device's id from the `did` cookie, or null (then the hashed IP stands in). */
  readonly deviceId: string | null;
  readonly captchaToken?: string;
};

const OK: GuardResult = { ok: true };
let sharedLimiter: RateLimiter | undefined;

const limiterOf = (deps: AbuseDeps): RateLimiter => {
  if (deps.limiter) return deps.limiter;
  sharedLimiter ??= createRateLimiter();
  return sharedLimiter;
};

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const idHash = (identifier: string): string => hash(identifier.trim().toLowerCase());
const lockKey = (ctx: SignInContext): string =>
  `lock:${idHash(ctx.identifier)}:${ctx.deviceId ?? hash(ctx.ip)}`;

async function within(limiter: RateLimiter, key: string, rule: LimitRule): Promise<GuardResult> {
  const result = await limiter.limit(key, rule);
  return result.allowed ? OK : { blocked: "rateLimited", until: result.resetAt };
}

/** Returns the first block in order, spending nothing on rules after it. */
async function firstBlock(checks: ReadonlyArray<() => Promise<GuardResult>>): Promise<GuardResult> {
  for (const check of checks) {
    const result = await check();
    if (!("ok" in result)) return result;
  }
  return OK;
}

/**
 * Sign-in: the (identifier, device) pair counts every attempt first, so the attempt after the tenth is
 * `locked` (with the time the window ends) rather than `rateLimited`. From the fourth attempt, or when
 * the identifier's account-wide counter is exceeded, a captcha is required; the account-wide counter
 * never locks, so another person's attempts can only make a device solve a captcha.
 */
export async function guardSignIn(ctx: SignInContext, deps: AbuseDeps = {}): Promise<GuardResult> {
  const limiter = limiterOf(deps);
  const limits = deps.limits ?? AUTH_LIMITS;
  const { pair, stepUpAfter, account } = limits.lockout;
  const id = idHash(ctx.identifier);

  const lock = await limiter.limit(lockKey(ctx), pair);
  if (!lock.allowed) return { blocked: "locked", until: lock.resetAt };
  let needsCaptcha = pair.max - lock.remaining > stepUpAfter;

  needsCaptcha = !(await limiter.limit(`lockacct:${id}`, account)).allowed || needsCaptcha;

  const limited = await firstBlock([
    () => within(limiter, `rl:signin:ip:${hash(ctx.ip)}`, limits.signIn.ip),
  ]);
  if (!("ok" in limited)) return limited;

  if (needsCaptcha) {
    const verify = deps.verifyCaptcha ?? verifyCaptcha;
    if (!(await verify(ctx.captchaToken, ctx.ip))) return { blocked: "captchaRequired" };
  }
  return OK;
}

/** A successful sign-in forgets that (identifier, device) pair's failures. */
export async function clearSignInFailures(
  ctx: Omit<SignInContext, "captchaToken">,
  deps: AbuseDeps = {},
): Promise<void> {
  await limiterOf(deps).reset(lockKey(ctx));
}

export async function guardSignUp(
  input: { ip: string },
  deps: AbuseDeps = {},
): Promise<GuardResult> {
  const limits = deps.limits ?? AUTH_LIMITS;
  return within(limiterOf(deps), `rl:signup:ip:${hash(input.ip)}`, limits.signUp.ip);
}

/** Code send (password reset, email verify): per account and per IP; the same for unknown accounts. */
export async function guardCodeSend(
  input: { identifier: string; ip: string },
  deps: AbuseDeps = {},
): Promise<GuardResult> {
  const limiter = limiterOf(deps);
  const limits = deps.limits ?? AUTH_LIMITS;
  return firstBlock([
    () => within(limiter, `rl:codesend:id:${idHash(input.identifier)}`, limits.codeSend.id),
    () => within(limiter, `rl:codesend:ip:${hash(input.ip)}`, limits.codeSend.ip),
  ]);
}

/** Code verify: per account, on top of the 5 attempts each code allows. */
export async function guardCodeVerify(
  input: { identifier: string },
  deps: AbuseDeps = {},
): Promise<GuardResult> {
  const limits = deps.limits ?? AUTH_LIMITS;
  return within(
    limiterOf(deps),
    `rl:codeverify:id:${idHash(input.identifier)}`,
    limits.codeVerify.id,
  );
}
