import { z } from "zod";
import { getLocale } from "@/i18n/server";
import { AppError } from "@/server/errors";
import { startCheckout } from "@/server/orders/checkout";
import { recheckOrder } from "@/server/orders/recheck";
import { getOrderViewForParty } from "@/server/orders/views";
import { protectedProcedure, router } from "../trpc";

const numberInput = z.object({ number: z.string().min(1, "errors.invalidInput").max(16) });

export const ordersRouter = router({
  /**
   * Starts or resumes a purchase. Role logic lives in the checkout service (a student buys for
   * themself, a parent for a linked child); refusals come back as reasons for the UI, a rate
   * limit as TOO_MANY_REQUESTS.
   */
  start: protectedProcedure
    .input(
      z.object({
        courseId: z.uuid({ error: "errors.invalidInput" }),
        beneficiaryStudentId: z.uuid({ error: "errors.invalidInput" }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await startCheckout({
        buyer: { id: ctx.user.id, role: ctx.user.role, name: ctx.user.name },
        courseId: input.courseId,
        beneficiaryStudentId: input.beneficiaryStudentId,
        locale: await getLocale(),
      });
      if (!result.ok && result.reason === "rate_limited") throw new AppError("rate_limited");
      return result;
    }),

  /** An order by number, for its buyer or beneficiary; anyone else gets not found. */
  get: protectedProcedure.input(numberInput).query(async ({ ctx, input }) => {
    const order = await getOrderViewForParty(ctx.user.id, input.number);
    if (!order) throw new AppError("not_found");
    return order;
  }),

  /** Re-runs payment confirmation for the order's latest invoice. */
  recheck: protectedProcedure.input(numberInput).mutation(async ({ ctx, input }) => {
    const result = await recheckOrder(ctx.user.id, input.number);
    if (result.kind === "not_found") throw new AppError("not_found");
    if (result.kind === "rate_limited") throw new AppError("rate_limited");
    return result.order;
  }),
});
