"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDictionary } from "@/i18n/server";
import { getActingUser } from "@/server/auth/acting-user";
import { echo, type FormState, fields, sendAfterResponse } from "@/server/auth/form-kit";
import { serverEnv } from "@/server/env";
import { sendTeacherEmail } from "./emails";
import { issueTeacherInvite } from "./invites";
import { decideTeacherApplication } from "./review";

// The admin teachers page (C1): decide an application, invite a teacher. Every action re-checks
// the acting admin (a two-factor-verified session; `getActingUser` is null otherwise).

const ADMIN_TEACHERS_PATH = "/dashboard/admin/teachers";

const decideSchema = z.object({
  teacher_id: z.uuid(),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(4000).default(""),
});

async function actingAdmin() {
  const user = await getActingUser();
  return user?.role === "admin" ? user : null;
}

/** Approve or reject one application; the applicant is emailed the decision (and the reason). */
export async function decideTeacherAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await actingAdmin();
  if (!admin) redirect("/dashboard");
  const { t, locale } = await getDictionary();
  const a = t.teachers.admin;
  const parsed = decideSchema.safeParse(fields(formData));
  if (!parsed.success) return { status: "error", message: a.error };
  const { teacher_id: teacherId, decision, reason } = parsed.data;
  const result = await decideTeacherApplication({
    adminId: admin.id,
    teacherId,
    decision,
    reason,
  });
  if (!result.ok) {
    const fieldErrors =
      result.reason === "reason_required"
        ? { reason: a.reasonRequired }
        : result.reason === "reason_too_long"
          ? { reason: a.reasonTooLong }
          : undefined;
    const message = result.reason === "not_pending" ? a.notPending : a.error;
    return {
      status: "error",
      // A reason error shows at the field only (one field: no summary list).
      message: fieldErrors ? undefined : message,
      fieldErrors,
      values: { reason },
    };
  }
  const { email, name, locale: saved } = result.recipient;
  const trimmed = reason.trim();
  sendAfterResponse(() =>
    sendTeacherEmail(
      email,
      saved,
      locale,
      decision === "approve"
        ? { kind: "approved", name }
        : { kind: "rejected", name, reason: trimmed },
    ),
  );
  revalidatePath(ADMIN_TEACHERS_PATH);
  redirect(`${ADMIN_TEACHERS_PATH}?done=${decision === "approve" ? "approved" : "rejected"}`);
}

/**
 * Invites a teacher by email. The link is built only from the configured BASE_URL; without one
 * no invite is issued (the token would be undeliverable).
 */
export async function inviteTeacherAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await actingAdmin();
  if (!admin) redirect("/dashboard");
  const { t, locale } = await getDictionary();
  const a = t.teachers.admin;
  const raw = fields(formData);
  const base = serverEnv().BASE_URL;
  if (!base) return { status: "error", message: a.error, values: echo(raw) };
  const result = await issueTeacherInvite({
    adminId: admin.id,
    name: typeof raw.name === "string" ? raw.name : "",
    email: typeof raw.email === "string" ? raw.email : "",
  });
  if (!result.ok) {
    const messages = {
      invalid: a.inviteInvalid,
      exists: a.inviteExists,
      rate_limited: a.inviteLimited,
    };
    return {
      status: "error",
      tone: result.reason === "rate_limited" ? "warning" : undefined,
      message: messages[result.reason],
      values: echo(raw),
    };
  }
  const link = new URL(`/teach/invite/${result.token}`, base).href;
  sendAfterResponse(() =>
    sendTeacherEmail(result.email, null, locale, { kind: "invite", name: result.name, link }),
  );
  return { status: "success", message: a.invited };
}
