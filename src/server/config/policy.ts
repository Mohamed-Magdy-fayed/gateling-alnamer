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
  /** "Contact support" from the device block screen: per student, per IP and platform-wide. */
  readonly supportRequest: {
    readonly user: LimitRule;
    readonly ip: LimitRule;
    readonly global: LimitRule;
  };
  /** Failed code verifies, the D32 pattern: a pair lock per (identifier, device) and a captcha-only account counter. */
  readonly codeVerify: { readonly pair: LimitRule; readonly account: LimitRule };
  /** "Add email" on the account page: per target address across all accounts, so one inbox cannot be flooded. */
  readonly addEmail: { readonly address: LimitRule };
  /** Parent-created child accounts: per parent per day. */
  readonly childCreate: { readonly parent: LimitRule };
  /** Invite redemption attempts (right or wrong): per student and per IP. */
  readonly inviteRedeem: { readonly student: LimitRule; readonly ip: LimitRule };
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
const DAY = 24 * HOUR;
/** Sliding-window limits for the auth actions (A2.2). */
export const AUTH_LIMITS: AuthLimits = {
  signIn: { ip: { max: 20, windowSec: MINUTES_15 } },
  signUp: { ip: { max: 5, windowSec: HOUR } },
  codeSend: { id: { max: 3, windowSec: MINUTES_15 }, ip: { max: 10, windowSec: HOUR } },
  supportRequest: {
    user: { max: 3, windowSec: DAY },
    ip: { max: 5, windowSec: DAY },
    global: { max: 20, windowSec: DAY },
  },
  addEmail: { address: { max: 3, windowSec: HOUR } },
  childCreate: { parent: { max: 10, windowSec: DAY } },
  inviteRedeem: { student: { max: 5, windowSec: MINUTES_15 }, ip: { max: 20, windowSec: HOUR } },
  codeVerify: {
    pair: { max: 10, windowSec: MINUTES_15 },
    account: { max: 30, windowSec: MINUTES_15 },
  },
  lockout: {
    pair: { max: 10, windowSec: MINUTES_15 },
    stepUpAfter: 3,
    account: { max: 30, windowSec: MINUTES_15 },
  },
};

/** D34: sessions kept per device; sharing the `did` cookie cannot multiply them. The oldest are revoked. */
export const MAX_SESSIONS_PER_DEVICE = 3;

/** How long a device id that signed in successfully stays "known" for the sign-in pair lock (D36). */
export const SEEN_DID_TTL_SEC = 30 * 24 * 60 * 60;

/** The device cookie lives 400 days, the browser cap; it is refreshed on every auth action. */
export const DEVICE_COOKIE_MAX_AGE_SEC = 400 * 24 * 60 * 60;

/** A pre-session (a correct password on a blocked device) only reaches device management for this long. */
export const PRE_SESSION_TTL_MS = 15 * 60 * 1000;

/** A code can be re-sent this long after the last one; also when a still-queued email counts as delayed. */
export const CODE_RESEND_COOLDOWN_MS = 60 * 1000;
/** How long the signed `rp` cookie that remembers a reset request's email stays valid. */
export const PENDING_RESET_TTL_MS = RESET_CODE_TTL_MS + 5 * 60 * 1000;

/** The daily purge removes verification codes consumed or expired for longer than this. */
export const CODE_PURGE_AFTER_MS = 24 * 60 * 60 * 1000;

/** A6 caps: parents per student, children per parent, live invites per parent, and an invite's life. */
export const MAX_PARENTS_PER_STUDENT = 2;
export const MAX_CHILDREN_PER_PARENT = 10;
export const MAX_ACTIVE_INVITES_PER_PARENT = 5;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Staff (teacher, admin, reviewer) need a two-factor-verified session for pages and tRPC (A4/A7b). */
export const TWO_FACTOR_ENFORCED = true;

/** T1: checkout starts per user (10 per 10 minutes) and order status re-checks per user. */
export const CHECKOUT_LIMIT: LimitRule = { max: 10, windowSec: 10 * 60 };
export const ORDER_RECHECK_LIMIT: LimitRule = { max: 20, windowSec: 10 * 60 };

/** T2: a playback URL lives 5 minutes (30 s clock leeway); playback URL requests per user. */
export const VIDEO_TOKEN_TTL_S = 5 * 60;
export const VIDEO_TOKEN_LEEWAY_S = 30;
export const PLAYBACK_LIMIT: LimitRule = { max: 60, windowSec: 10 * 60 };

/** T4: a late quiz submit within this grace is on time; later ones are still graded as-is. */
export const QUIZ_GRACE_S = 10;
/** T4: quiz starts and submits per user. */
export const QUIZ_LIMIT: LimitRule = { max: 30, windowSec: 10 * 60 };

/** T5: draft courses created per teacher. */
export const DRAFT_COURSE_LIMIT: LimitRule = { max: 20, windowSec: 60 * 60 };

/** A4: two-factor code attempts per user (every attempt counts; a success clears the count). */
export const TWO_FACTOR_LIMIT: LimitRule = { max: 5, windowSec: 15 * 60 };

/** A4: two-factor code attempts per user per day, on top of the 15-minute lock. */
export const TWO_FACTOR_DAILY_LIMIT: LimitRule = { max: 30, windowSec: 24 * 60 * 60 };
