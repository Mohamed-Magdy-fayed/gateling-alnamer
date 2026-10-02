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
/** The pre-`__Host-` cookie `alnamer_session` is still read until this instant (H1 removes it). */
export const LEGACY_COOKIE_UNTIL = new Date("2026-11-01T00:00:00.000Z");
