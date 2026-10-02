/** Product policy constants. Later steps add to this file. */
export const RESET_CODE_TTL_MS = 1000 * 60 * 10;
export const RESET_MAX_ATTEMPTS = 5;
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

/** Precomputed argon2id hash (standard parameters) of a throwaway string; never matches a user input. */
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$vPEJbf+/Ft5uI01506nxzA$owAvBhscXfMW0tN/UDhFVG6MLTB33nhQG7xqBzPxIQo";
