import { z } from "zod";
import { requestContext } from "@/server/auth/request-context";
import { AppError } from "@/server/errors";
import { redeemInvite, unlinkParent } from "@/server/parents/service";
import { listParentsForStudent } from "@/server/parents/views";
import { roleProcedure, router } from "../trpc";

const studentProcedure = roleProcedure("student");

export const studentRouter = router({
  parentLinks: router({
    redeem: studentProcedure
      .input(
        z.object({
          code: z.string().min(1, "errors.invalidInput").max(32, "errors.invalidInput"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { ip } = await requestContext();
        const result = await redeemInvite({
          studentId: ctx.user.id,
          code: input.code,
          ip,
        });
        if (result.ok) return { linked: true };
        switch (result.code) {
          case "invalid":
            throw new AppError("invalid_input", {
              i18nKey: "parents.linkInvalid",
            });
          case "limitParents":
            throw new AppError("invalid_input", {
              i18nKey: "parents.limitParents",
            });
          case "limitChildren":
            throw new AppError("invalid_input", {
              i18nKey: "parents.limitChildren",
            });
          case "rateLimited":
            throw new AppError("rate_limited");
        }
      }),

    list: studentProcedure.query(({ ctx }) => listParentsForStudent(ctx.user.id)),

    unlink: studentProcedure
      .input(z.object({ parentId: z.uuid({ error: "errors.invalidInput" }) }))
      .mutation(async ({ ctx, input }) => {
        const result = await unlinkParent({
          actor: { id: ctx.user.id, role: ctx.user.role },
          parentId: input.parentId,
          studentId: ctx.user.id,
        });
        if (result.ok) return { unlinked: true };
        throw new AppError(result.reason);
      }),
  }),
});
