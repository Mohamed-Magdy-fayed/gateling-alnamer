"use client";

import { useActionState } from "react";
import { type AuthText, idle, Message } from "@/components/auth-parts";
import type { Dictionary } from "@/i18n/ar";
import { inviteTeacherAction } from "@/server/catalog/teachers/admin-actions";
import { Field } from "@/ui";
import { SubmitButton } from "@/ui/submit-button";

type TeachersText = Dictionary["teachers"];

/** The admin invite form (C1): a name and an email; the link is emailed, never shown. */
export function InviteForm({ t, auth }: { t: TeachersText; auth: AuthText }) {
  const [state, action] = useActionState(inviteTeacherAction, idle);
  const a = t.admin;
  // React resets the form after each submit; a refused invite echoes the fields back.
  const values = state.values;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Message state={state} t={auth} />
      <Field
        id="invite-name"
        name="name"
        label={auth.fields.name}
        autoComplete="off"
        defaultValue={values?.name}
        required
        minLength={2}
      />
      <Field
        id="invite-email"
        name="email"
        type="email"
        label={auth.fields.email}
        autoComplete="off"
        defaultValue={values?.email}
        required
        ltr
      />
      <SubmitButton>{a.invite}</SubmitButton>
    </form>
  );
}
