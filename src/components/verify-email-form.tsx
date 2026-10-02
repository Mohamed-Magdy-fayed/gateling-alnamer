"use client";

import { useActionState } from "react";
import { CodeInput } from "@/components/al/code-input";
import type { Dictionary } from "@/i18n/ar";
import { type FormState, verifyEmailAction } from "@/server/auth/actions";
import { Alert, ButtonLink } from "@/ui";
import { SubmitButton } from "@/ui/submit-button";
import { Message, useRetryBlock } from "./auth-parts";
import { CodeDelivery } from "./code-delivery";

type AuthText = Dictionary["auth"];
const idle: FormState = { status: "idle" };

/** The confirmed state with the way on; also what /verify-email shows an already-verified user. */
export function EmailVerified({ t }: { t: AuthText }) {
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="success">{t.states.verified}</Alert>
      <ButtonLink href="/dashboard" size="lg" className="w-full">
        {t.verify.continue}
      </ButtonLink>
    </div>
  );
}

export function VerifyEmailForm({ t }: { t: AuthText }) {
  const [state, action] = useActionState(verifyEmailAction, idle);
  const block = useRetryBlock(state.retryAt, t);
  if (state.status === "success") return <EmailVerified t={t} />;
  return (
    <div className="flex flex-col gap-6">
      <form action={action} className="flex flex-col gap-4" noValidate>
        <Message state={state} t={t} />
        <CodeInput name="code" label={t.fields.code} required />
        <SubmitButton disabled={block.blocked} disabledReason={block.reason}>
          {t.verify.submit}
        </SubmitButton>
      </form>
      <CodeDelivery purpose="email_verify" t={t} />
    </div>
  );
}
