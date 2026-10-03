import { z } from "zod";
import { AppError } from "@/server/errors";
import { quizStateFor, startQuizFor, submitQuizFor } from "@/server/quiz/service";
import { protectedProcedure, router } from "../trpc";

const lessonInput = z.object({ lessonId: z.uuid({ error: "errors.invalidInput" }) });

/** Answers: question id to option id; the server keeps only the quiz's own ids. */
const answersInput = z
  .record(z.string().max(64), z.string().max(64))
  .refine((value) => Object.keys(value).length <= 200, { message: "errors.invalidInput" });

export const quizRouter = router({
  /** The lesson's quiz and the caller's attempts (never the answer key). */
  state: protectedProcedure
    .input(lessonInput)
    .query(async ({ ctx, input }) =>
      quizStateFor(
        { id: ctx.user.id, role: ctx.user.role, deviceId: ctx.sessionDeviceId ?? null },
        input.lessonId,
      ),
    ),

  start: protectedProcedure.input(lessonInput).mutation(async ({ ctx, input }) => {
    const result = await startQuizFor(
      { id: ctx.user.id, role: ctx.user.role, deviceId: ctx.sessionDeviceId ?? null },
      input.lessonId,
    );
    if (!result.ok && result.reason === "rate_limited") throw new AppError("rate_limited");
    return result;
  }),

  submit: protectedProcedure
    .input(
      lessonInput.extend({
        attemptId: z.uuid({ error: "errors.invalidInput" }),
        answers: answersInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await submitQuizFor(
        { id: ctx.user.id, role: ctx.user.role, deviceId: ctx.sessionDeviceId ?? null },
        input.lessonId,
        input.attemptId,
        input.answers,
      );
      if (!result.ok && result.reason === "rate_limited") throw new AppError("rate_limited");
      return result;
    }),
});
