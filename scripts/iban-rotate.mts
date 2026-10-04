// Re-seals teacher IBANs after an IBAN key rotation (C2). `npm run iban:rotate` locally (with
// `.env`, local databases only) and `vercel-build` on Vercel run it. A no-op unless
// IBAN_ENCRYPTION_KEY_PREVIOUS is set. Exits 1 when a row could not be opened, so a deploy with
// the wrong previous key stops instead of leaving rows nobody can read.
//
// Runbook (also in docs/deploy.md):
//   1. Generate a key: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//   2. Set IBAN_ENCRYPTION_KEY_PREVIOUS = the current key, IBAN_ENCRYPTION_KEY = the new key,
//      IBAN_KEY_VERSION = current version + 1 (1 when it was never set). Deploy (or run locally).
//   3. The build log shows "rotated N, unreadable 0, remaining 0". Then remove
//      IBAN_ENCRYPTION_KEY_PREVIOUS and deploy again. Keep the old key offline until then.

import { loadLocalEnv, parseLocalArgs } from "./lib/local-env.mjs";

if (!process.env.VERCEL) {
  try {
    loadLocalEnv(parseLocalArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`iban:rotate: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

if (!process.env.IBAN_ENCRYPTION_KEY_PREVIOUS) {
  console.log("iban:rotate: skipped (IBAN_ENCRYPTION_KEY_PREVIOUS is not set).");
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("iban:rotate: DATABASE_URL is not set.");
  process.exit(1);
}

const { parseServerEnv } = await import("../src/server/env-schema");
try {
  parseServerEnv(process.env);
} catch (error) {
  console.error(`iban:rotate: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const { drizzle } = await import("drizzle-orm/postgres-js");
const { default: postgres } = await import("postgres");
const schema = await import("../src/server/db/schema");
const { ibanKeyring } = await import("../src/server/payouts/payout-crypto");
const { rotateIbanKeys } = await import("../src/server/payouts/rotate");

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  const ring = ibanKeyring(process.env);
  const result = await rotateIbanKeys(drizzle(client, { schema }), ring);
  console.log(
    `iban:rotate: key version ${ring.version}: rotated ${result.rotated}, unreadable ${result.unreadable}, remaining ${result.remaining}.`,
  );
  if (result.unreadable > 0) {
    console.error(
      "iban:rotate: some rows did not open with IBAN_ENCRYPTION_KEY_PREVIOUS; check the keys before removing it.",
    );
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
