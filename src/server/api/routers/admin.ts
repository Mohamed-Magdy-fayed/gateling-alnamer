import { z } from "zod";
import { resetTwoFactor } from "@/server/auth/two-factor";
import { listPendingReview, publishCourse } from "@/server/catalog/authoring";
import { resetStudentDevices } from "@/server/devices/service";
import { AppError } from "@/server/errors";
import { router, staffProcedure, superAdminProcedure } from "../trpc";

const adminProcedure = staffProcedure("admin");

export const adminRouter = router({
  twoFactor: router({
    /** Lost phone: removes the user's factors and sessions (audit-logged). Super admin only. */
    reset: superAdminProcedure
      .input(z.object({ userId: z.uuid({ error: "errors.invalidInput" }) }))
      .mutation(async ({ ctx, input }) => {
        if (input.userId === ctx.user.id) throw new AppError("forbidden");
        await resetTwoFactor(ctx.user.id, input.userId);
        return { ok: true as const };
      }),
  }),
  content: router({
    /** Courses waiting to be published. */
    pending: adminProcedure.query(async () => listPendingReview()),
    /** Publishes an in-review course (audit-logged). */
    publish: adminProcedure
      .input(z.object({ courseId: z.uuid({ error: "errors.invalidInput" }) }))
      .mutation(async ({ ctx, input }) => publishCourse(ctx.user.id, input.courseId)),
  }),
  devices: router({
    /** Revokes a student's devices and their sessions (audit-logged). */
    reset: adminProcedure
      .input(z.object({ userId: z.uuid({ error: "errors.invalidInput" }) }))
      .mutation(async ({ ctx, input }) => {
        const result = await resetStudentDevices(input.userId, ctx.user.id);
        if (!result.ok) throw new AppError("invalid_input", { message: result.reason });
        return { revoked: result.revoked };
      }),
  }),
});
