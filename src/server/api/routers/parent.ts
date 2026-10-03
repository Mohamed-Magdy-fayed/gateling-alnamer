import { z } from "zod";
import { getLocale } from "@/i18n/server";
import { AppError } from "@/server/errors";
import {
  createChild,
  issueInvite,
  listChildrenForParent,
  resetChildPassword,
  unlinkParent,
} from "@/server/parents/service";
import { listActiveInvites } from "@/server/parents/views";
import { roleProcedure, router } from "../trpc";

const parentProcedure = roleProcedure("parent");

const FIELD_KEY = "auth.errors.field";
const VERIFY_FIRST_KEY = "parents.verifyFirst";
const childIdInput = z.object({
  childId: z.uuid({ error: "errors.invalidInput" }),
});
const createChildInput = z.object({
  name: z.string({ error: `${FIELD_KEY}.name` }).max(200, `${FIELD_KEY}.name`),
  username: z.string({ error: `${FIELD_KEY}.username` }).max(200, `${FIELD_KEY}.username`),
  password: z.string({ error: `${FIELD_KEY}.password` }).max(1024, `${FIELD_KEY}.password`),
  dateOfBirth: z
    .string({ error: `${FIELD_KEY}.date_of_birth` })
    .max(32, `${FIELD_KEY}.date_of_birth`),
});
const resetInput = childIdInput.extend({
  newPassword: z.string().max(1024, `${FIELD_KEY}.password`).optional(),
});

export const parentRouter = router({
  children: router({
    list: parentProcedure.query(({ ctx }) => listChildrenForParent(ctx.user.id)),

    create: parentProcedure.input(createChildInput).mutation(async ({ ctx, input }) => {
      const { dateOfBirth, ...rest } = input;
      const result = await createChild(
        ctx.user.id,
        { ...rest, date_of_birth: dateOfBirth },
        { locale: await getLocale() },
      );
      if (result.ok) return { childId: result.childId };
      switch (result.code) {
        case "invalid":
          throw new AppError("invalid_input", {
            i18nKey: result.fields[0] ? `${FIELD_KEY}.${result.fields[0]}` : "auth.errors.invalid",
          });
        case "duplicate":
          throw new AppError("invalid_input", {
            i18nKey: "auth.errors.checkDetails",
          });
        case "forbidden":
          throw new AppError("forbidden");
        case "verifyFirst":
          throw new AppError("invalid_input", { i18nKey: VERIFY_FIRST_KEY });
        case "rateLimited":
          throw new AppError("rate_limited");
        case "limitChildren":
          throw new AppError("invalid_input", {
            i18nKey: "parents.limitChildren",
          });
      }
    }),

    resetPassword: parentProcedure.input(resetInput).mutation(async ({ ctx, input }) => {
      const result = await resetChildPassword(
        {
          parentId: ctx.user.id,
          childId: input.childId,
          newPassword: input.newPassword,
        },
        { locale: await getLocale() },
      );
      if (result.ok) return { mode: result.mode };
      switch (result.reason) {
        case "forbidden":
          throw new AppError("forbidden");
        case "verifyFirst":
          throw new AppError("invalid_input", { i18nKey: VERIFY_FIRST_KEY });
        case "rateLimited":
          throw new AppError("rate_limited");
        case "invalid":
          throw new AppError("invalid_input", {
            i18nKey: `${FIELD_KEY}.password`,
          });
        case "no_verified_email":
          throw new AppError("invalid_input", {
            i18nKey: "errors.invalidInput",
          });
      }
    }),

    unlink: parentProcedure.input(childIdInput).mutation(async ({ ctx, input }) => {
      const result = await unlinkParent({
        actor: { id: ctx.user.id, role: ctx.user.role },
        parentId: ctx.user.id,
        studentId: input.childId,
      });
      if (result.ok) return { unlinked: true };
      throw new AppError(result.reason);
    }),
  }),

  invites: router({
    /** The only place the plain code is ever returned. */
    create: parentProcedure.mutation(async ({ ctx }) => {
      const result = await issueInvite(ctx.user.id);
      if (result.ok) return { code: result.code, expiresAt: result.expiresAt };
      if (result.code === "forbidden") throw new AppError("forbidden");
      if (result.code === "verifyFirst") {
        throw new AppError("invalid_input", { i18nKey: VERIFY_FIRST_KEY });
      }
      throw new AppError("invalid_input", { i18nKey: "parents.limitInvites" });
    }),

    list: parentProcedure.query(({ ctx }) => listActiveInvites(ctx.user.id)),
  }),
});
