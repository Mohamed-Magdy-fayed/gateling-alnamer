import { z } from "zod";
import { AppError } from "@/server/errors";
import { requestPlayback } from "@/server/video/playback";
import { protectedProcedure, router } from "../trpc";

export const videoRouter = router({
  /**
   * A short-lived playback URL for a lesson's video, issued only after `getLessonAccess` with the
   * session's own device. A denial comes back as its reason for the player; a limit as
   * TOO_MANY_REQUESTS.
   */
  playback: protectedProcedure
    .input(z.object({ lessonId: z.uuid({ error: "errors.invalidInput" }) }))
    .mutation(async ({ ctx, input }) => {
      const result = await requestPlayback(
        { id: ctx.user.id, role: ctx.user.role, deviceId: ctx.sessionDeviceId ?? null },
        input.lessonId,
      );
      if (!result.ok && result.reason === "rate_limited") throw new AppError("rate_limited");
      return result;
    }),
});
