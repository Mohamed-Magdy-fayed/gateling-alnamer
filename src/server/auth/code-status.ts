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
 * What the code screens show. A reset always reports `sent`: `issuedAt` (from the pending cookie)
 * anchors the resend cooldown for known and unknown accounts alike, and no delivery state is read
 * at all, so a status poll can never tell a registered email from an unregistered one. Only the
 * signed-in user's own email verification reports the real state (queued, sent, failed).
 */
export function describeCodeStatus(input: {
  purpose: CodePurpose;
  row: CodeRow | null;
  issuedAt?: number;
  now: Date;
}): CodeStatus {
  const { purpose, row } = input;
  const anchor = input.issuedAt ?? row?.createdAt.getTime();
  if (anchor === undefined) return { status: "sent", canResendAt: 0 };
  return {
    status: purpose === "password_reset" ? "sent" : (row?.emailStatus ?? "sent"),
    canResendAt: anchor + CODE_RESEND_COOLDOWN_MS,
  };
}
