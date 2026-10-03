import { eq } from "drizzle-orm";
import { z } from "zod";
import { resetTwoFactor } from "@/server/auth/two-factor";
import { listPendingReview, publishCourse } from "@/server/catalog/authoring";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { resetDevices } from "@/server/devices/service";
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
    reset: adminProcedure.input(z.object({ userId: z.uuid() })).mutation(async ({ ctx, input }) => {
      const target = await db().query.users.findFirst({
        where: eq(users.id, input.userId),
        columns: { role: true },
      });
      if (target?.role !== "student") {
        throw new AppError("invalid_input", {
          message: "target must be a student",
        });
      }
      return { revoked: await resetDevices(input.userId, ctx.user.id) };
    }),
  }),
});
