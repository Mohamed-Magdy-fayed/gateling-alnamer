// Pure pieces of scripts/migrate.mts so the URL choice and the unlock handling are unit-testable.

// Session advisory locks need a direct (non-pooled) connection: a transaction pooler such as Neon's
// PgBouncer can hand the unlock to a different backend. Neon's Vercel integration sets
// DATABASE_URL_UNPOOLED for exactly this; locally it is normally unset.
export function pickMigrationUrl(env) {
  return env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || undefined;
}

// Runs `work` while holding the lock. An unlock failure is logged and never replaces the work's
// own error (or turns a successful run into a failure); `end` always runs.
export async function withMigrationLock({ lock, unlock, end, work, log = console.error }) {
  await lock();
  try {
    return await work();
  } finally {
    try {
      await unlock();
    } catch (error) {
      log(
        `db:migrate: could not release the advisory lock: ${error instanceof Error ? error.message : error}`,
      );
    }
    await end();
  }
}
