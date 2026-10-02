"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
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

const linkClass = "font-medium text-primary underline-offset-4 hover:underline";
const summaryLinkClass = "font-medium underline underline-offset-4";

/** Focuses the field a summary entry points at (a plain fragment jump does not focus buttons). */
function FieldLink({ field, children }: { field: string; children: string }) {
  const id = `field-${field}`;
  return (
    <a
      href={`#${id}`}
      className={summaryLinkClass}
      onClick={(event) => {
        event.preventDefault();
        document.getElementById(id)?.focus();
      }}
    >
      {children}
    </a>
  );
}

/**
 * Form-level result. After every submit it takes focus (a `tabIndex={-1}` alert) so keyboard and
 * screen-reader users land on the outcome; field-format errors are listed as links to the fields.
 */
function Message({ state, t }: { state: FormState; t: AuthText }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status !== "idle") ref.current?.focus();
  }, [state]);
  if (state.status === "idle" || !state.message) return null;
  const failing = Object.entries(state.fieldErrors ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return (
    <Alert ref={ref} tabIndex={-1} tone={state.status === "error" ? "danger" : "success"}>
      {state.message}
      {state.offerReset ? (
        <>
          {" "}
          <Link href="/forgot-password" className={linkClass}>
            {t.signIn.forgot}
          </Link>
        </>
      ) : null}
      {failing.length > 0 ? (
        <ul className="mt-1 list-disc ps-5">
          {failing.map(([field, message]) => (
            <li key={field}>
              <FieldLink field={field}>{message}</FieldLink>
            </li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}

function RequiredNote({ t }: { t: AuthText }) {
  return <p className="text-sm text-fg-muted">{t.fields.requiredNote}</p>;
}

export function SignInForm({ t }: { t: AuthText }) {
  const [state, action] = useActionState(signInAction, idle);
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

/** A form id that does not exist: keeps Radix from resetting the radio group when React resets the form. */
const NO_FORM = "role-radio-detached";

function toRole(value: string | undefined): Role {
  return roles.find((item) => item === value) ?? "student";
}

type SignUpFormProps = { t: AuthText; defaultRole: string; locale: Locale };

export function SignUpForm({ t, defaultRole, locale }: SignUpFormProps) {
  const [state, action] = useActionState(signUpAction, idle);
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
      <RequiredNote t={t} />
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
      <PasswordInput
        name="password"
        label={t.reset.newPassword}
        hint={t.fields.passwordHint}
        autoComplete="new-password"
        toggleLabel={t.fields.showPassword}
        minLength={8}
        required
      />
      <SubmitButton>{t.reset.submit}</SubmitButton>
    </form>
  );
}
