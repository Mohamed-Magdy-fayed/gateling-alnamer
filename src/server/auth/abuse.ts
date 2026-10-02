import { AUTH_LIMITS, type AuthLimits, type LimitRule } from "@/server/config/policy";
import { createRateLimiter, type RateLimiter } from "@/server/rate-limit";
import { type CaptchaVerifier, verifyCaptcha } from "./captcha";
import { authKey, keyedHash } from "./keys";

export type { CaptchaVerifier };

/**
 * Abuse guards for the auth actions. Every key is built from keyed hashes (HMAC under the `rl`
 * sub-key of AUTH_SECRET: `rl:<action>:ip:<h(ip)>`, `rl:<action>:id:<h(lower(identifier))>`,
 * `lock:<h(identifier)>:<device or h(ip)>`), never from a raw email, username or IP, and not from a
 * bare sha256 that a leaked key list could be matched against offline. Decisions depend only on those counters, never on whether
 * the account exists, so known and unknown identifiers behave identically.
 */

export type GuardResult =
  | { ok: true }
  | { blocked: "rateLimited" | "locked" | "captchaRequired"; until?: Date };

export type AbuseDeps = {
  readonly limiter?: RateLimiter;
  readonly limits?: AuthLimits;
  readonly verifyCaptcha?: CaptchaVerifier;
  /** The `rl` sub-key (tests inject one; production derives it from AUTH_SECRET). */
  readonly key?: Buffer;
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

type Hasher = { hash(value: string): string; id(identifier: string): string };
const hasherOf = (deps: AbuseDeps): Hasher => {
  const key = deps.key ?? authKey("rl");
  const hash = (value: string): string => keyedHash(key, value);
  return { hash, id: (identifier) => hash(identifier.trim().toLowerCase()) };
};
const pairOf = (h: Hasher, ctx: { identifier: string; ip: string; deviceId: string | null }) =>
  `${h.id(ctx.identifier)}:${ctx.deviceId ?? h.hash(ctx.ip)}`;
const lockKey = (h: Hasher, ctx: SignInContext): string => `lock:${pairOf(h, ctx)}`;

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
  const h = hasherOf(deps);
  const id = h.id(ctx.identifier);

  const lock = await limiter.limit(lockKey(h, ctx), pair);
  if (!lock.allowed) return { blocked: "locked", until: lock.resetAt };
  let needsCaptcha = pair.max - lock.remaining > stepUpAfter;

  needsCaptcha = !(await limiter.limit(`lockacct:${id}`, account)).allowed || needsCaptcha;

  const limited = await firstBlock([
    () => within(limiter, `rl:signin:ip:${h.hash(ctx.ip)}`, limits.signIn.ip),
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
  await limiterOf(deps).reset(lockKey(hasherOf(deps), ctx));
}

export async function guardSignUp(
  input: { ip: string },
  deps: AbuseDeps = {},
): Promise<GuardResult> {
  const limits = deps.limits ?? AUTH_LIMITS;
  return within(limiterOf(deps), `rl:signup:ip:${hasherOf(deps).hash(input.ip)}`, limits.signUp.ip);
}

/** "Contact support" from the device block screen: 3 a day per student, 5 per IP, 20 platform-wide. */
export async function guardSupportRequest(
  input: { userId: string; ip: string },
  deps: AbuseDeps = {},
): Promise<GuardResult> {
  const limiter = limiterOf(deps);
  const { supportRequest } = deps.limits ?? AUTH_LIMITS;
  const h = hasherOf(deps);
  return firstBlock([
    () => within(limiter, `rl:support:user:${h.hash(input.userId)}`, supportRequest.user),
    () => within(limiter, `rl:support:ip:${h.hash(input.ip)}`, supportRequest.ip),
    () => within(limiter, "rl:support:global", supportRequest.global),
  ]);
}

/** Code send (password reset, email verify): per account and per IP; the same for unknown accounts. */
export async function guardCodeSend(
  input: { identifier: string; ip: string },
  deps: AbuseDeps = {},
): Promise<GuardResult> {
  const limiter = limiterOf(deps);
  const limits = deps.limits ?? AUTH_LIMITS;
  const h = hasherOf(deps);
  return firstBlock([
    () => within(limiter, `rl:codesend:id:${h.id(input.identifier)}`, limits.codeSend.id),
    () => within(limiter, `rl:codesend:ip:${h.hash(input.ip)}`, limits.codeSend.ip),
  ]);
}

export type CodeVerifyContext = {
  readonly purpose: "email_verify" | "password_reset";
  readonly identifier: string;
  readonly ip: string;
  /** The returning device's id from the `did` cookie, or null (then the hashed IP stands in). */
  readonly deviceId: string | null;
  readonly captchaToken?: string;
};

const verifyKeys = (h: Hasher, ctx: CodeVerifyContext) => ({
  pair: `vlock:${ctx.purpose}:${pairOf(h, ctx)}`,
  account: `vlockacct:${ctx.purpose}:${h.id(ctx.identifier)}`,
});

/**
 * Code verify, the D32 pattern: the (identifier, device) pair counts every verify first, so the
 * attempt after the tenth is `locked`; the identifier's account-wide counter (30 per window) only
 * demands a captcha from every device and never blocks, so someone else's guesses cannot lock the
 * owner out. A success clears both (`clearCodeVerifyFailures`), which leaves only failures counted.
 * Reset and email verification are counted separately.
 */
export async function guardCodeVerify(
  ctx: CodeVerifyContext,
  deps: AbuseDeps = {},
): Promise<GuardResult> {
  const limiter = limiterOf(deps);
  const { pair, account } = (deps.limits ?? AUTH_LIMITS).codeVerify;
  const keys = verifyKeys(hasherOf(deps), ctx);

  const lock = await limiter.limit(keys.pair, pair);
  if (!lock.allowed) return { blocked: "locked", until: lock.resetAt };
  const needsCaptcha = !(await limiter.limit(keys.account, account)).allowed;
  if (!needsCaptcha) return OK;
  const verify = deps.verifyCaptcha ?? verifyCaptcha;
  return (await verify(ctx.captchaToken, ctx.ip)) ? OK : { blocked: "captchaRequired" };
}

/** A successful verify forgets that pair's and that account's failures. */
export async function clearCodeVerifyFailures(
  ctx: Omit<CodeVerifyContext, "captchaToken">,
  deps: AbuseDeps = {},
): Promise<void> {
  const limiter = limiterOf(deps);
  const keys = verifyKeys(hasherOf(deps), ctx);
  await Promise.all([limiter.reset(keys.pair), limiter.reset(keys.account)]);
}
