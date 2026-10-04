/** True for a Postgres unique violation (23505), also when a driver or Drizzle wraps it in `cause`. */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === "23505") return true;
  return isUniqueViolation((error as { cause?: unknown }).cause);
}

/** True for a Postgres foreign key violation (23503), also when wrapped in `cause`. */
export function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === "23503") return true;
  return isForeignKeyViolation((error as { cause?: unknown }).cause);
}
