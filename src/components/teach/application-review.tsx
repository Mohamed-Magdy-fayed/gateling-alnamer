"use client";

import { useActionState, useId } from "react";
import { TextAreaField } from "@/components/al/text-area-field";
import { type AuthText, idle, Message } from "@/components/auth-parts";
import type { Dictionary } from "@/i18n/ar";
import { decideTeacherAction } from "@/server/catalog/teachers/admin-actions";
import { Button, Card, LoadingSwap, Ltr } from "@/ui";

type TeachersText = Dictionary["teachers"];

type Props = {
  t: TeachersText;
  auth: AuthText;
  teacherId: string;
  name: string;
  email: string | null;
  note: string | null;
  /** Already formatted in the viewer's locale. */
  appliedOn: string;
};

/**
 * One application on the admin teachers page (C1): who, what they teach, and the decision. The
 * reason is optional to approve and required to reject (the applicant receives it by email).
 */
export function ApplicationReview({ t, auth, teacherId, name, email, note, appliedOn }: Props) {
  const [state, action, pending] = useActionState(decideTeacherAction, idle);
  const headingId = useId();
  const a = t.admin;
  return (
    <Card className="flex flex-col gap-4 p-5">
      <article aria-labelledby={headingId} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 id={headingId} className="font-semibold">
            <bdi>{name}</bdi>
          </h3>
          {email ? <Ltr className="text-sm text-fg-2 break-all">{email}</Ltr> : null}
          <span className="text-sm text-fg-muted">{appliedOn}</span>
        </div>
        {note ? (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-fg-2">{a.note}</span>
            <p className="max-w-prose text-sm leading-7 whitespace-pre-line">
              <bdi>{note}</bdi>
            </p>
          </div>
        ) : null}
        <form action={action} className="flex flex-col gap-3" noValidate>
          <Message state={state} t={auth} />
          <input type="hidden" name="teacher_id" value={teacherId} />
          <TextAreaField
            id={`reason-${teacherId}`}
            name="reason"
            label={a.reason}
            hint={a.reasonHint}
            defaultValue={state.values?.reason}
            error={state.fieldErrors?.reason}
            maxLength={1000}
            className="min-h-20"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              name="decision"
              value="approve"
              className="min-h-11"
              disabled={pending}
            >
              <LoadingSwap pending={pending}>{a.approve}</LoadingSwap>
            </Button>
            <Button
              type="submit"
              name="decision"
              value="reject"
              variant="outline"
              className="min-h-11"
              disabled={pending}
            >
              {a.reject}
            </Button>
          </div>
        </form>
      </article>
    </Card>
  );
}
