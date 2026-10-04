"use client";

import { useActionState } from "react";
import { DateInput } from "@/components/al/date-input";
import { PasswordInput } from "@/components/al/password-input";
import { RequiredNote } from "@/components/auth-forms";
import { type AuthText, idle, Message, useRetryBlock } from "@/components/auth-parts";
import type { Dictionary } from "@/i18n/ar";
import { dirOf, type Locale } from "@/i18n/config";
import { redeemInviteAction } from "@/server/catalog/teachers/actions";
import { Ltr } from "@/ui";
import { SubmitButton } from "@/ui/submit-button";

type TeachersText = Dictionary["teachers"];

type Props = {
  t: TeachersText;
  auth: AuthText;
  locale: Locale;
  token: string;
  name: string;
  email: string;
};

/** Accept a teacher invitation (C1): the invited name and email, then a password and birth date. */
export function InviteRedeemForm({ t, auth, locale, token, name, email }: Props) {
  const [state, action] = useActionState(redeemInviteAction, idle);
  const block = useRetryBlock(state.retryAt, auth);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Message state={state} t={auth} />
      <div className="flex flex-col gap-1 rounded-sm bg-sunken p-4">
        <span className="text-sm text-fg-2">{t.invite.invitedAs}</span>
        <bdi className="font-semibold">{name}</bdi>
        <Ltr className="text-sm break-all text-fg-2">{email}</Ltr>
      </div>
      <RequiredNote t={auth} />
      <input type="hidden" name="token" value={token} />
      {/* Lets password managers save the new password against the invited email. */}
      <input type="hidden" name="username" autoComplete="username" value={email} />
      <PasswordInput
        name="password"
        label={auth.fields.password}
        hint={auth.fields.passwordHint}
        error={errors.password}
        autoComplete="new-password"
        toggleLabel={auth.fields.showPassword}
        required
        minLength={8}
      />
      <DateInput
        name="date_of_birth"
        legend={auth.signUp.dob}
        labels={{ day: auth.signUp.dobDay, month: auth.signUp.dobMonth, year: auth.signUp.dobYear }}
        locale={locale}
        dir={dirOf(locale)}
        defaultValue={state.values?.date_of_birth ?? ""}
        error={errors.date_of_birth}
        required
      />
      <SubmitButton disabled={block.blocked} disabledReason={block.reason}>
        {t.invite.submit}
      </SubmitButton>
    </form>
  );
}
