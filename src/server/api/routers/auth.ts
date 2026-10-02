import { z } from "zod";
import { describeCodeStatus, latestCodeRow } from "@/server/auth/code-status";
import { readPendingReset } from "@/server/auth/pending-reset";
import { clock } from "@/server/clock";
import { AppError } from "@/server/errors";
import { publicProcedure, router } from "../trpc";

export const authRouter = router({
  /**
   * Delivery state of the code the caller is waiting for: the signed-in user's verification code, or
   * the reset in progress (named by the signed pending cookie, never by an input or an echoed
   * email). A reset reports `sent` without looking the account up, so it reveals nothing about it.
   */
  codeStatus: publicProcedure
    .input(z.object({ purpose: z.enum(["email_verify", "password_reset"]) }))
    .query(async ({ input, ctx }) => {
      const now = clock.now();
      if (input.purpose === "email_verify") {
        if (!ctx.user) throw new AppError("forbidden");
        const row = await latestCodeRow(ctx.user.id, "email_verify");
        return describeCodeStatus({ purpose: "email_verify", row, now });
      }
      const pending = await readPendingReset();
      return describeCodeStatus({
        purpose: "password_reset",
        row: null,
        issuedAt: pending?.issuedAt,
        now,
      });
    }),
});
