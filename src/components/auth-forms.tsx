"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Captcha, type CaptchaConfig } from "@/components/al/captcha";
import { CodeInput } from "@/components/al/code-input";
import { DateInput } from "@/components/al/date-input";
import { PasswordInput } from "@/components/al/password-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { dirOf, type Locale } from "@/i18n/config";
import {
  requestPasswordResetAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
} from "@/server/auth/actions";
import { isUnder18 } from "@/server/auth/age";
import { Alert, cn, describedBy, Field } from "@/ui";
import { SubmitButton } from "@/ui/submit-button";
import { type AuthText, idle, linkClass, Message, useRetryBlock } from "./auth-parts";
import { CodeDelivery } from "./code-delivery";

function RequiredNote({ t }: { t: AuthText }) {
  return <p className="text-sm text-fg-muted">{t.fields.requiredNote}</p>;
}

type CaptchaProps = { captcha: CaptchaConfig; locale: Locale };

export function SignInForm({ t, captcha, locale }: { t: AuthText } & CaptchaProps) {
  const [state, action] = useActionState(signInAction, idle);
  const block = useRetryBlock(state.retryAt, t);
  // Once the server asks for a captcha the widget stays for the rest of this visit.
  const [needsCaptcha, setNeedsCaptcha] = useState(false);
  if (state.captchaRequired && !needsCaptcha) setNeedsCaptcha(true);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Message state={state} t={t} />
      <RequiredNote t={t} />
      <Field
        name="identifier"
        label={t.fields.identifier}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        defaultValue={state.values?.identifier}
        required
        ltr
      />
      <PasswordInput
        name="password"
        label={t.fields.password}
        autoComplete="current-password"
        toggleLabel={t.fields.showPassword}
        required
      />
      {state.offerReset ? null : (
        <Link href="/forgot-password" className={cn(linkClass, "self-start text-sm")}>
          {t.signIn.forgot}
        </Link>
      )}
      {needsCaptcha ? (
        <Captcha
          config={captcha}
          locale={locale}
          label={t.states.captchaLabel}
          failedMessage={t.states.captchaFailed}
          resetKey={state}
        />
      ) : null}
      <SubmitButton disabled={block.blocked} disabledReason={block.reason}>
        {t.signIn.submit}
      </SubmitButton>
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

/** A form id that does not exist: keeps Radix from resetting the radio group when React resets the form. */
const NO_FORM = "role-radio-detached";

function toRole(value: string | undefined): Role {
  return roles.find((item) => item === value) ?? "student";
}

type SignUpFormProps = {
  t: AuthText;
  defaultRole: string;
  locale: Locale;
  captcha: CaptchaConfig;
  /** The private-window / cleared-data device notice, shown while Student is picked. */
  deviceNotice: string;
};

export function SignUpForm({ t, defaultRole, locale, captcha, deviceNotice }: SignUpFormProps) {
  const [state, action] = useActionState(signUpAction, idle);
  const block = useRetryBlock(state.retryAt, t);
  const dir = dirOf(locale);
  const errors = state.fieldErrors ?? {};
  // The role follows the last action state until the user picks one: React resets the form after a
  // failed submit, so the radio is controlled by the submitted value instead of by the DOM.
  const [picked, setPicked] = useState<Role | null>(null);
  const role = picked ?? toRole(state.values?.role ?? defaultRole);
  const [dob, setDob] = useState(state.values?.date_of_birth ?? "");
  const needsConsent = role === "student" && dob !== "" && isUnder18(dob, new Date());
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Message state={state} t={t} />
      <RequiredNote t={t} />
      <fieldset className="flex flex-col gap-2">
        <input type="hidden" name="role" value={role} />
        <legend id="signup-role-legend" className="mb-1.5 text-sm font-medium">
          {t.signUp.roleLegend}
        </legend>
        <RadioGroup
          form={NO_FORM}
          dir={dir}
          value={role}
          onValueChange={(value) => setPicked(toRole(value))}
          aria-labelledby="signup-role-legend"
          className="grid-cols-2"
        >
          {roles.map((item) => (
            <RadioGroupItem key={item} value={item}>
              {t.signUp.roles[item]}
            </RadioGroupItem>
          ))}
        </RadioGroup>
        <div aria-live="polite">
          {role === "student" ? <Alert tone="info">{deviceNotice}</Alert> : null}
        </div>
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
        toggleLabel={t.fields.showPassword}
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
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="field-guardian_consent"
              className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 leading-6 font-normal"
            >
              <Checkbox
                id="field-guardian_consent"
                name="guardian_consent"
                defaultChecked={state.values?.guardian_consent === "on"}
                aria-invalid={errors.guardian_consent ? true : undefined}
                aria-describedby={describedBy("field-guardian_consent", {
                  error: errors.guardian_consent,
                })}
              />
              <span>{t.signUp.consent}</span>
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
      ) : null}
      <Captcha
        config={captcha}
        locale={locale}
        label={t.states.captchaLabel}
        failedMessage={t.states.captchaFailed}
        resetKey={state}
      />
      <SubmitButton disabled={block.blocked} disabledReason={block.reason}>
        {t.signUp.submit}
      </SubmitButton>
      <p className="text-center text-sm text-fg-2">
        {t.signUp.haveAccount}{" "}
        <Link href="/sign-in" className={linkClass}>
          {t.signIn.title}
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm({ t, captcha, locale }: { t: AuthText } & CaptchaProps) {
  const [state, action] = useActionState(requestPasswordResetAction, idle);
  const block = useRetryBlock(state.retryAt, t);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Message state={state} t={t} />
      <Field name="email" type="email" label={t.fields.email} autoComplete="email" required ltr />
      <Captcha
        config={captcha}
        locale={locale}
        label={t.states.captchaLabel}
        failedMessage={t.states.captchaFailed}
        resetKey={state}
      />
      <SubmitButton disabled={block.blocked} disabledReason={block.reason}>
        {t.forgot.submit}
      </SubmitButton>
      <Link href="/reset-password" className={cn(linkClass, "justify-center text-center text-sm")}>
        {t.forgot.haveCode}
      </Link>
    </form>
  );
}

/** `pending`: a code was just requested in this browser, so the account is known server-side. */
type ResetPasswordFormProps = { t: AuthText; pending: boolean } & CaptchaProps;

export function ResetPasswordForm({ t, pending, captcha, locale }: ResetPasswordFormProps) {
  const [state, action] = useActionState(resetPasswordAction, idle);
  const block = useRetryBlock(state.retryAt, t);
  // After 30 failed verifies on the email the server wants a captcha; the widget then stays.
  const [needsCaptcha, setNeedsCaptcha] = useState(false);
  if (state.captchaRequired && !needsCaptcha) setNeedsCaptcha(true);
  if (state.status === "success") {
    return (
      <div className="flex flex-col gap-4">
        <Message state={state} t={t} />
        <Link href="/sign-in" className={cn(linkClass, "justify-center text-center")}>
          {t.signIn.title}
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <form action={action} className="flex flex-col gap-4" noValidate>
        <Message state={state} t={t} />
        {pending && state.status === "idle" ? <Alert tone="info">{t.states.codeSent}</Alert> : null}
        <RequiredNote t={t} />
        {pending ? null : (
          <Field
            name="email"
            type="email"
            label={t.fields.email}
            autoComplete="email"
            required
            ltr
          />
        )}
        <CodeInput name="code" label={t.fields.code} focusOnMount={pending} required />
        <PasswordInput
          name="password"
          label={t.reset.newPassword}
          hint={t.fields.passwordHint}
          autoComplete="new-password"
          toggleLabel={t.fields.showPassword}
          minLength={8}
          required
        />
        {needsCaptcha ? (
          <Captcha
            config={captcha}
            locale={locale}
            label={t.states.captchaLabel}
            failedMessage={t.states.captchaFailed}
            resetKey={state}
          />
        ) : null}
        <SubmitButton disabled={block.blocked} disabledReason={block.reason}>
          {t.reset.submit}
        </SubmitButton>
      </form>
      {pending ? <CodeDelivery purpose="password_reset" t={t} /> : null}
    </div>
  );
}
