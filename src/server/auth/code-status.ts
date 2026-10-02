import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { CODE_RESEND_COOLDOWN_MS } from "@/server/config/policy";
import { db } from "@/server/db";
import { verificationCodes } from "@/server/db/schema";
import type { CodePurpose } from "./codes";

type Database = ReturnType<typeof db>;

export type EmailStatus = "queued" | "sent" | "failed";
export type CodeStatus = {
  status: EmailStatus;
  /** Epoch ms when a resend opens; 0 when it is open now. */
  canResendAt: number;
};
export type CodeRow = { emailStatus: EmailStatus; createdAt: Date };

/** The newest unconsumed code's delivery state, or null when there is none. */
export async function latestCodeRow(
  userId: string,
  purpose: CodePurpose,
  database: Database = db(),
): Promise<CodeRow | null> {
  const [row] = await database
    .select({ emailStatus: verificationCodes.emailStatus, createdAt: verificationCodes.createdAt })
    .from(verificationCodes)
    .where(
      and(
        eq(verificationCodes.userId, userId),
        eq(verificationCodes.purpose, purpose),
        isNull(verificationCodes.consumedAt),
      ),
    )
    .orderBy(desc(verificationCodes.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * What the code screens show. For a reset, `issuedAt` (from the pending cookie) anchors the resend
 * cooldown for known and unknown accounts alike, an unknown account (no row) reads as sent, and a
 * queued send younger than the cooldown also reads as sent: only a send that has really failed or
 * stalled differs, so a status poll does not tell a registered email from an unregistered one.
 */
export function describeCodeStatus(input: {
  purpose: CodePurpose;
  row: CodeRow | null;
  issuedAt?: number;
  now: Date;
}): CodeStatus {
  const { purpose, row, now } = input;
  const anchor = input.issuedAt ?? row?.createdAt.getTime();
  if (anchor === undefined) return { status: "sent", canResendAt: 0 };
  const status = row?.emailStatus ?? "sent";
  const fresh = now.getTime() - anchor < CODE_RESEND_COOLDOWN_MS;
  return {
    status: purpose === "password_reset" && status === "queued" && fresh ? "sent" : status,
    canResendAt: anchor + CODE_RESEND_COOLDOWN_MS,
  };
}
