"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { Dictionary } from "@/i18n/ar";
import {
  type FormState,
  requestPasswordResetAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
} from "@/server/auth/actions";
import { Alert, cn, Field } from "@/ui";
import { SubmitButton } from "@/ui/submit-button";

type AuthText = Dictionary["auth"];
const idle: FormState = { status: "idle" };

function Message({ state }: { state: FormState }) {
  if (state.status === "idle" || !state.message) return null;
  return <Alert tone={state.status === "error" ? "danger" : "success"}>{state.message}</Alert>;
}

const linkClass = "font-medium text-primary underline-offset-4 hover:underline";

export function SignInForm({ t }: { t: AuthText }) {
  const [state, action] = useActionState(signInAction, idle);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Message state={state} />
      <Field name="email" type="email" label={t.fields.email} autoComplete="email" required ltr />
      <Field
        name="password"
        type="password"
        label={t.fields.password}
        autoComplete="current-password"
        required
        ltr
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

const roles = ["student", "parent", "teacher"] as const;

export function SignUpForm({ t, defaultRole }: { t: AuthText; defaultRole: string }) {
  const [state, action] = useActionState(signUpAction, idle);
  const initialRole = roles.find((role) => role === defaultRole) ?? "student";
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Message state={state} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">{t.signUp.roleLegend}</legend>
        <div className="grid grid-cols-3 gap-2">
          {roles.map((role) => (
            <label
              key={role}
              className="flex min-h-11 cursor-pointer items-center justify-center rounded-[var(--radius-md)] border border-line-strong bg-raised px-2 text-sm font-medium has-checked:border-primary has-checked:bg-primary-soft has-checked:text-primary-soft-fg has-focus-visible:outline-2 has-focus-visible:outline-focus"
            >
              <input
                type="radio"
                name="role"
                value={role}
                defaultChecked={role === initialRole}
                className="sr-only"
              />
              {t.signUp.roles[role]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field name="name" label={t.fields.name} autoComplete="name" required minLength={2} />
      <Field name="email" type="email" label={t.fields.email} autoComplete="email" required ltr />
      <Field
        name="password"
        type="password"
        label={t.fields.password}
        hint={t.fields.passwordHint}
        autoComplete="new-password"
        required
        minLength={8}
        ltr
      />
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
      <Message state={state} />
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
        <Message state={state} />
        <Link href="/sign-in" className={cn(linkClass, "text-center")}>
          {t.signIn.title}
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Message state={state} />
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
