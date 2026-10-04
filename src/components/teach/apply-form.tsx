"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Captcha, type CaptchaConfig } from "@/components/al/captcha";
import { DateInput } from "@/components/al/date-input";
import { PasswordInput } from "@/components/al/password-input";
import { TextAreaField } from "@/components/al/text-area-field";
import { RequiredNote } from "@/components/auth-forms";
import { type AuthText, idle, linkClass, Message, useRetryBlock } from "@/components/auth-parts";
import type { Dictionary } from "@/i18n/ar";
import { dirOf, type Locale } from "@/i18n/config";
import { applyTeacherAction } from "@/server/catalog/teachers/actions";
import { Alert, Field } from "@/ui";
import { SubmitButton } from "@/ui/submit-button";

type TeachersText = Dictionary["teachers"];

type Props = {
  t: TeachersText;
  auth: AuthText;
  captcha: CaptchaConfig;
  locale: Locale;
};

/** The teacher application (C1): account fields, date of birth and what they teach. */
export function TeacherApplyForm({ t, auth, captcha, locale }: Props) {
  const [state, action] = useActionState(applyTeacherAction, idle);
  const block = useRetryBlock(state.retryAt, auth);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Message state={state} t={auth} />
      <RequiredNote t={auth} />
      <Field
        name="name"
        label={auth.fields.name}
        autoComplete="name"
        defaultValue={state.values?.name}
        error={errors.name}
        required
        minLength={2}
      />
      <Field
        name="email"
        type="email"
        label={auth.fields.email}
        autoComplete="email"
        defaultValue={state.values?.email}
        error={errors.email}
        required
        ltr
      />
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
      <TextAreaField
        name="note"
        label={t.apply.note}
        hint={t.apply.noteHint}
        defaultValue={state.values?.note}
        error={errors.note}
        required
        minLength={10}
        maxLength={1000}
      />
      <Alert tone="info">{t.apply.twoFactorNote}</Alert>
      <Captcha
        config={captcha}
        locale={locale}
        label={auth.states.captchaLabel}
        failedMessage={auth.states.captchaFailed}
        resetKey={state}
      />
      <SubmitButton disabled={block.blocked} disabledReason={block.reason}>
        {t.apply.submit}
      </SubmitButton>
      <p className="text-center text-sm text-fg-2">
        {t.apply.haveAccount}{" "}
        <Link href="/sign-in" className={linkClass}>
          {t.apply.signIn}
        </Link>
      </p>
    </form>
  );
}
