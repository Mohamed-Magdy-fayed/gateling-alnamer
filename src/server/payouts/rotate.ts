import "server-only";
import { and, asc, count, eq, lt, notInArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { writeAudit } from "@/server/audit/repository";
import type * as schema from "@/server/db/schema";
import { teacherPayoutDetails } from "@/server/db/schema";
import { type IbanKeyring, openIban, sealIban } from "./payout-crypto";

// IBAN key rotation (C2), run by `npm run iban:rotate` and by `vercel-build` while
// IBAN_ENCRYPTION_KEY_PREVIOUS is set. Re-seals every row of an older key version under the
// current key. Each row is updated only if it still has the version it was read with, so a rerun
// or a concurrent teacher save is safe. Runbook: docs/deploy.md, "Rotating the IBAN key".

export type RotateResult = { rotated: number; unreadable: number; remaining: number };

type Conn = PostgresJsDatabase<typeof schema>;

const DEFAULT_BATCH = 100;

export async function rotateIbanKeys(
  conn: Conn,
  ring: IbanKeyring,
  batchSize = DEFAULT_BATCH,
): Promise<RotateResult> {
  if (!ring.keys.has(ring.version - 1)) {
    throw new Error("IBAN_ENCRYPTION_KEY_PREVIOUS is not set; nothing to rotate from");
  }
  const skipped: string[] = [];
  let rotated = 0;
  for (;;) {
    const older = lt(teacherPayoutDetails.keyVersion, ring.version);
    const batch = await conn
      .select({
        userId: teacherPayoutDetails.userId,
        ciphertext: teacherPayoutDetails.ibanCiphertext,
        keyVersion: teacherPayoutDetails.keyVersion,
      })
      .from(teacherPayoutDetails)
      .where(
        skipped.length > 0 ? and(older, notInArray(teacherPayoutDetails.userId, skipped)) : older,
      )
      .orderBy(asc(teacherPayoutDetails.userId))
      .limit(batchSize);
    if (batch.length === 0) break;
    for (const row of batch) {
      const iban = openIban(ring, row.userId, row);
      if (!iban) {
        skipped.push(row.userId);
        continue;
      }
      const sealed = sealIban(ring, row.userId, iban);
      const updated = await conn
        .update(teacherPayoutDetails)
        .set({ ibanCiphertext: sealed.ciphertext, keyVersion: sealed.keyVersion })
        .where(
          and(
            eq(teacherPayoutDetails.userId, row.userId),
            eq(teacherPayoutDetails.keyVersion, row.keyVersion),
          ),
        )
        .returning({ userId: teacherPayoutDetails.userId });
      rotated += updated.length;
    }
  }
  const [left] = await conn
    .select({ n: count() })
    .from(teacherPayoutDetails)
    .where(lt(teacherPayoutDetails.keyVersion, ring.version));
  const result = { rotated, unreadable: skipped.length, remaining: left?.n ?? 0 };
  await writeAudit(conn, {
    actorId: null,
    action: "payout_details.keys_rotated",
    subjectType: "payout_details",
    after: { ...result, keyVersion: ring.version },
  });
  return result;
}
