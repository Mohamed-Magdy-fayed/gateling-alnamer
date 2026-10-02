import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { resetDevices } from "@/server/devices/service";
import { AppError } from "@/server/errors";
import { publicProcedure, router } from "../trpc";

/** Admin-only gate. A7a replaces it with the shared roleProcedure. */
const adminProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (ctx.user?.role !== "admin") throw new AppError("forbidden", { message: "admin only" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const adminRouter = router({
  devices: router({
    reset: adminProcedure.input(z.object({ userId: z.uuid() })).mutation(async ({ ctx, input }) => {
      const target = await db().query.users.findFirst({
        where: eq(users.id, input.userId),
        columns: { role: true },
      });
      if (target?.role !== "student") {
        throw new AppError("invalid_input", { message: "target must be a student" });
      }
      return { revoked: await resetDevices(input.userId, ctx.user.id) };
    }),
  }),
});
