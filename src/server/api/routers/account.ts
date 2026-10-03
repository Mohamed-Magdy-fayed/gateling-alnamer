import { z } from "zod";
import { locales } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import {
  changePassword,
  confirmAddedEmail,
  listSessions,
  requestAddedEmail,
  revokeSession,
  updateProfile,
} from "@/server/account/service";
import { clearCodeVerifyFailures, guardCodeVerify } from "@/server/auth/abuse";
import { requestContext } from "@/server/auth/request-context";
import { setSessionCookie } from "@/server/auth/session";
import { clock } from "@/server/clock";
import { listActiveDevices, nextSelfRemovalAt, removeDevice } from "@/server/devices/service";
import { AppError } from "@/server/errors";
import { protectedProcedure, roleProcedure, router } from "../trpc";

const INVALID = "errors.invalidInput";
const studentProcedure = roleProcedure("student");

const name = z.string().trim().min(1, INVALID).max(80, INVALID);
const email = z.string().trim().pipe(z.email(INVALID)).pipe(z.string().max(254, INVALID));
const password = z.string().min(8, INVALID).max(128, INVALID);
const code = z.string().regex(/^\d{6}$/, INVALID);

export const accountRouter = router({
  updateProfile: protectedProcedure
    .input(z.object({ name, locale: z.enum(locales, INVALID) }))
    .mutation(async ({ ctx, input }) => {
      await updateProfile(ctx.user.id, input);
      return { saved: true as const };
    }),

  /** Always answers codeSent (when not rate limited), taken address or not. */
  addEmail: protectedProcedure.input(z.object({ email })).mutation(async ({ ctx, input }) => {
    const [{ ip }, locale] = await Promise.all([requestContext(), getLocale()]);
    await requestAddedEmail({ userId: ctx.user.id, address: input.email, ip, locale });
    return { codeSent: true as const };
  }),

  verifyAddedEmail: protectedProcedure
    .input(z.object({ code }))
    .mutation(async ({ ctx, input }) => {
      const { ip, deviceId } = await requestContext();
      const who = {
        purpose: "email_verify",
        identifier: ctx.user.id,
        ip,
        deviceId,
      } as const;
      const guard = await guardCodeVerify(who);
      if (!("ok" in guard)) throw new AppError("rate_limited");
      if (!(await confirmAddedEmail(ctx.user.id, input.code))) {
        throw new AppError("invalid_input", { i18nKey: "auth.states.codeInvalid" });
      }
      await clearCodeVerifyFailures(who);
      return { verified: true as const };
    }),

  changePassword: protectedProcedure
    .input(z.object({ current: z.string().min(1, INVALID).max(128, INVALID), next: password }))
    .mutation(async ({ ctx, input }) => {
      const { rotated } = await changePassword({
        userId: ctx.user.id,
        current: input.current,
        next: input.next,
        currentTokenHash: ctx.sessionTokenHash,
      });
      // After the commit: the old token is dead, so the browser must carry the new one.
      if (rotated) await setSessionCookie(rotated.token, rotated.expiresAt);
      return { changed: true as const };
    }),

  listSessions: protectedProcedure.query(({ ctx }) =>
    listSessions({
      userId: ctx.user.id,
      role: ctx.user.role,
      currentTokenHash: ctx.sessionTokenHash,
    }),
  ),

  revokeSession: protectedProcedure
    .input(z.object({ id: z.uuid(INVALID) }))
    .mutation(async ({ ctx, input }) => {
      await revokeSession({
        userId: ctx.user.id,
        id: input.id,
        currentTokenHash: ctx.sessionTokenHash,
      });
      return { revoked: true as const };
    }),

  listDevices: studentProcedure.query(async ({ ctx }) => {
    const [list, nextRemovalAt] = await Promise.all([
      listActiveDevices(ctx.user.id),
      nextSelfRemovalAt(ctx.user.id),
    ]);
    const now = clock.now();
    return {
      devices: list.map((device) => ({
        id: device.id,
        label: device.label,
        lastSeenAt: device.lastSeenAt,
        current: device.id === ctx.sessionDeviceId,
      })),
      // A throttle that already lapsed reads as "allowed now".
      nextRemovalAt: nextRemovalAt && nextRemovalAt > now ? nextRemovalAt : null,
    };
  }),

  removeDevice: studentProcedure
    .input(z.object({ deviceId: z.uuid(INVALID) }))
    .mutation(async ({ ctx, input }) => {
      if (input.deviceId === ctx.sessionDeviceId) {
        throw new AppError("forbidden", { message: "current_device" });
      }
      const { deviceKey } = await requestContext();
      const result = await removeDevice({
        userId: ctx.user.id,
        deviceId: input.deviceId,
        currentDeviceKey: deviceKey,
      });
      if (result.ok) return { removed: true as const };
      switch (result.reason) {
        case "not_found":
          throw new AppError("not_found");
        case "is_current":
          throw new AppError("forbidden", { message: "current_device" });
        case "throttled":
          throw new AppError("rate_limited");
      }
    }),
});
