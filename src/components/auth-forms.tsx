"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { DateInput } from "@/components/al/date-input";
import { PasswordInput } from "@/components/al/password-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { Dictionary } from "@/i18n/ar";
import { dirOf, type Locale } from "@/i18n/config";
import {
  type FormState,
  requestPasswordResetAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
} from "@/server/auth/actions";
import { isUnder18 } from "@/server/auth/age";
import { Alert, cn, describedBy, Field } from "@/ui";
import { SubmitButton } from "@/ui/submit-button";

type AuthText = Dictionary["auth"];
const idle: FormState = { status: "idle" };

function Message({ state, t }: { state: FormState; t: AuthText }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <Alert tone={state.status === "error" ? "danger" : "success"}>
      {state.message}
      {state.offerReset ? (
        <>
          {" "}
          <Link href="/forgot-password" className={linkClass}>
            {t.signIn.forgot}
          </Link>
        </>
      ) : null}
    </Alert>
  );
}

const linkClass = "font-medium text-primary underline-offset-4 hover:underline";

export function SignInForm({ t }: { t: AuthText }) {
  const [state, action] = useActionState(signInAction, idle);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Message state={state} t={t} />
      <Field
        name="identifier"
        label={t.fields.identifier}
        autoComplete="username"
        defaultValue={state.values?.identifier}
        required
        ltr
      />
      <PasswordInput
        name="password"
        label={t.fields.password}
        autoComplete="current-password"
        showLabel={t.fields.showPassword}
        hideLabel={t.fields.hidePassword}
        required
      />
      <Link href="/forgot-password" className={cn(linkClass, "self-start text-sm")}>
        {t.signIn.forgot}
      </Link>
      <SubmitButton>{t.signIn.submit}</SubmitButton>
      <p className="text-center text-sm text-fg-2">
        {t.signIn.noAccount}{" "}
        <Link href="/sign-up" className={linkClass}>
          {t.signUp.title}
        </Link>
      </p>
    </form>
  );
}

const roles = ["student", "parent"] as const;
type Role = (typeof roles)[number];

type SignUpFormProps = { t: AuthText; defaultRole: string; locale: Locale };

export function SignUpForm({ t, defaultRole, locale }: SignUpFormProps) {
  const [state, action] = useActionState(signUpAction, idle);
  const dir = dirOf(locale);
  const errors = state.fieldErrors ?? {};
  const [role, setRole] = useState<Role>(
    roles.find((item) => item === (state.values?.role ?? defaultRole)) ?? "student",
  );
  const [dob, setDob] = useState(state.values?.date_of_birth ?? "");
  const needsConsent = role === "student" && dob !== "" && isUnder18(dob, new Date());
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Message state={state} t={t} />
      <fieldset className="flex flex-col gap-2">
        <legend id="signup-role-legend" className="mb-1.5 text-sm font-medium">
          {t.signUp.roleLegend}
        </legend>
        <RadioGroup
          name="role"
          dir={dir}
          value={role}
          onValueChange={(value) => setRole(value === "parent" ? "parent" : "student")}
          aria-labelledby="signup-role-legend"
          className="grid-cols-2"
        >
          {roles.map((item) => (
            <RadioGroupItem key={item} value={item}>
              {t.signUp.roles[item]}
            </RadioGroupItem>
          ))}
        </RadioGroup>
      </fieldset>
      <Field
        name="name"
        label={t.fields.name}
        autoComplete="name"
        defaultValue={state.values?.name}
        error={errors.name}
        required
        minLength={2}
      />
      <Field
        name="email"
        type="email"
        label={t.fields.email}
        autoComplete="email"
        defaultValue={state.values?.email}
        error={errors.email}
        required
        ltr
      />
      <Field
        name="username"
        label={t.signUp.username}
        hint={t.signUp.usernameHint}
        autoComplete="username"
        defaultValue={state.values?.username}
        error={errors.username}
        maxLength={20}
        autoCapitalize="none"
        spellCheck={false}
        ltr
      />
      <PasswordInput
        name="password"
        label={t.fields.password}
        hint={t.fields.passwordHint}
        error={errors.password}
        autoComplete="new-password"
        showLabel={t.fields.showPassword}
        hideLabel={t.fields.hidePassword}
        required
        minLength={8}
      />
      <DateInput
        name="date_of_birth"
        legend={t.signUp.dob}
        labels={{ day: t.signUp.dobDay, month: t.signUp.dobMonth, year: t.signUp.dobYear }}
        locale={locale}
        dir={dir}
        defaultValue={dob}
        error={errors.date_of_birth}
        onValueChange={setDob}
        required
      />
      {needsConsent ? (
        <div className="flex flex-col gap-3">
          <Alert tone="info">{t.states.under18Consent}</Alert>
          <div className="flex items-start gap-3">
            <Checkbox
              id="field-guardian_consent"
              name="guardian_consent"
              defaultChecked={state.values?.guardian_consent === "on"}
              aria-invalid={errors.guardian_consent ? true : undefined}
              aria-describedby={describedBy("field-guardian_consent", {
                error: errors.guardian_consent,
              })}
              className="mt-0.5"
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="field-guardian_consent" className="leading-6 font-normal">
                {t.signUp.consent}
              </Label>
              <p
                id="field-guardian_consent-error"
                aria-live="polite"
                className={errors.guardian_consent ? "text-sm text-destructive" : "sr-only"}
              >
                {errors.guardian_consent}
              </p>
            </div>
          </div>
        </div>
      ) : null}
      <SubmitButton>{t.signUp.submit}</SubmitButton>
      <p className="text-center text-sm text-fg-2">
        {t.signUp.haveAccount}{" "}
        <Link href="/sign-in" className={linkClass}>
          {t.signIn.title}
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm({ t }: { t: AuthText }) {
  const [state, action] = useActionState(requestPasswordResetAction, idle);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Message state={state} t={t} />
      <Field name="email" type="email" label={t.fields.email} autoComplete="email" required ltr />
      <SubmitButton>{t.forgot.submit}</SubmitButton>
      <Link
        href={
          state.email
            ? `/reset-password?email=${encodeURIComponent(state.email)}`
            : "/reset-password"
        }
        className={cn(linkClass, "text-center text-sm")}
      >
        {t.forgot.haveCode}
      </Link>
    </form>
  );
}

export function ResetPasswordForm({ t, email }: { t: AuthText; email: string }) {
  const [state, action] = useActionState(resetPasswordAction, idle);
  if (state.status === "success") {
    return (
      <div className="flex flex-col gap-4">
        <Message state={state} t={t} />
        <Link href="/sign-in" className={cn(linkClass, "text-center")}>
          {t.signIn.title}
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Message state={state} t={t} />
      <Field
        name="email"
        type="email"
        label={t.fields.email}
        autoComplete="email"
        defaultValue={email}
        required
        ltr
      />
      <Field
        name="code"
        label={t.reset.code}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        ltr
        className="tabular tracking-[0.4em]"
      />
      <Field
        name="password"
        type="password"
        label={t.reset.newPassword}
        hint={t.fields.passwordHint}
        autoComplete="new-password"
        minLength={8}
        required
        ltr
      />
      <SubmitButton>{t.reset.submit}</SubmitButton>
    </form>
  );
}
