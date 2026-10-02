"use client";

import { type Ref, useActionState, useEffect, useRef, useState } from "react";
import { Captcha, type CaptchaConfig } from "@/components/al/captcha";
import { CodeInput } from "@/components/al/code-input";
import type { Locale } from "@/i18n/config";
import { verifyEmailAction } from "@/server/auth/actions";
import { Alert, ButtonLink } from "@/ui";
import { SubmitButton } from "@/ui/submit-button";
import { type AuthText, idle, Message, useRetryBlock } from "./auth-parts";
import { CodeDelivery } from "./code-delivery";

type EmailVerifiedProps = { t: AuthText; alertRef?: Ref<HTMLDivElement> };

/** The confirmed state with the way on. Given `alertRef`, the alert is a focus target (-1). */
function EmailVerified({ t, alertRef }: EmailVerifiedProps) {
  return (
    <div className="flex flex-col gap-4">
      <Alert ref={alertRef} tabIndex={alertRef ? -1 : undefined} tone="success">
        {t.states.verified}
      </Alert>
      <ButtonLink href="/dashboard" size="lg" className="w-full">
        {t.verify.continue}
      </ButtonLink>
    </div>
  );
}

type VerifyEmailFormProps = {
  t: AuthText;
  captcha: CaptchaConfig;
  locale: Locale;
  /** The account's email is already confirmed (the server's view; true again after a success). */
  verified: boolean;
};

/**
 * The code form, which turns into the confirmed state in place. The form stays mounted through the
 * server re-render that follows a success, so the verified alert can take focus and the page
 * heading (rendered by the server from `verified`) changes around it.
 */
export function VerifyEmailForm({ t, captcha, locale, verified }: VerifyEmailFormProps) {
  const [state, action] = useActionState(verifyEmailAction, idle);
  const block = useRetryBlock(state.retryAt, t);
  const verifiedAlert = useRef<HTMLDivElement>(null);
  const succeeded = state.status === "success";
  useEffect(() => {
    if (succeeded) verifiedAlert.current?.focus();
  }, [succeeded]);
  // After 30 failed verifies on the account the server wants a captcha; the widget then stays.
  const [needsCaptcha, setNeedsCaptcha] = useState(false);
  if (state.captchaRequired && !needsCaptcha) setNeedsCaptcha(true);
  if (succeeded) return <EmailVerified t={t} alertRef={verifiedAlert} />;
  if (verified) return <EmailVerified t={t} />;
  return (
    <div className="flex flex-col gap-6">
      <form action={action} className="flex flex-col gap-4" noValidate>
        <Message state={state} t={t} />
        <CodeInput name="code" label={t.fields.code} required />
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
          {t.verify.submit}
        </SubmitButton>
      </form>
      <CodeDelivery purpose="email_verify" t={t} />
    </div>
  );
}
