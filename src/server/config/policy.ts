/** Product policy constants. Later steps add to this file. */
export const RESET_CODE_TTL_MS = 1000 * 60 * 10;
export const RESET_MAX_ATTEMPTS = 5;
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

/** Precomputed argon2id hash (standard parameters) of a throwaway string; never matches a user input. */
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$vPEJbf+/Ft5uI01506nxzA$owAvBhscXfMW0tN/UDhFVG6MLTB33nhQG7xqBzPxIQo";

const DAY_MS = 1000 * 60 * 60 * 24;
/** Sliding sessions: when less than this remains, a read extends the session to a full TTL. */
export const SESSION_SLIDE_THRESHOLD_MS = 15 * DAY_MS;
/** The session cookie is re-issued (expiry refreshed) at most this often. */
export const SESSION_COOKIE_REFRESH_MS = DAY_MS;
/** `sessions.last_seen_at` is written only when older than this. */
export const SESSION_LAST_SEEN_INTERVAL_MS = 1000 * 60 * 5;
/** Redis session cache lifetime; also the longest a revoked session could outlive a lost cache delete. */
export const SESSION_CACHE_TTL_SEC = 60;
/** Youngest age that may sign up as a student; younger children are created by a parent (A6). */
export const MIN_STUDENT_SIGNUP_AGE = 8;

export type LimitRule = { readonly max: number; readonly windowSec: number };
export type AuthLimits = {
  /** Per IP only: a per-identifier hard limit would let an attacker rate-limit the victim on every device. */
  readonly signIn: { readonly ip: LimitRule };
  readonly signUp: { readonly ip: LimitRule };
  readonly codeSend: { readonly id: LimitRule; readonly ip: LimitRule };
  readonly codeVerify: { readonly id: LimitRule };
  readonly lockout: {
    /** Attempts per (identifier, device) pair; the attempt after the last allowed one is locked. */
    readonly pair: LimitRule;
    /** Failures on a pair after which a captcha is required. */
    readonly stepUpAfter: number;
    /** Attempts per identifier across all devices after which every device needs a captcha; never locks. */
    readonly account: LimitRule;
  };
};

const MINUTES_15 = 15 * 60;
const HOUR = 60 * 60;
/** Sliding-window limits for the auth actions (A2.2). */
export const AUTH_LIMITS: AuthLimits = {
  signIn: { ip: { max: 20, windowSec: MINUTES_15 } },
  signUp: { ip: { max: 5, windowSec: HOUR } },
  codeSend: { id: { max: 3, windowSec: MINUTES_15 }, ip: { max: 10, windowSec: HOUR } },
  codeVerify: { id: { max: 10, windowSec: MINUTES_15 } },
  lockout: {
    pair: { max: 10, windowSec: MINUTES_15 },
    stepUpAfter: 3,
    account: { max: 30, windowSec: MINUTES_15 },
  },
};

/** The device cookie lives 400 days, the browser cap; it is refreshed on every auth action. */
export const DEVICE_COOKIE_MAX_AGE_SEC = 400 * 24 * 60 * 60;

/** A code can be re-sent this long after the last one; also when a still-queued email counts as delayed. */
export const CODE_RESEND_COOLDOWN_MS = 60 * 1000;
/** How long the signed `rp` cookie that remembers a reset request's email stays valid. */
export const PENDING_RESET_TTL_MS = RESET_CODE_TTL_MS + 5 * 60 * 1000;
