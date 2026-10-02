"use client";

import { useQuery } from "@tanstack/react-query";
import { useActionState, useEffect, useState } from "react";
import { CODE_FIELD_ID } from "@/components/al/code-input";
import type { Dictionary } from "@/i18n/ar";
import { useTRPC } from "@/lib/trpc/client";
import { type FormState, resendCodeAction } from "@/server/auth/actions";
import { CODE_RESEND_COOLDOWN_MS } from "@/server/config/policy";
import { Alert } from "@/ui";
import { SubmitButton } from "@/ui/submit-button";
import { useRetryBlock } from "./auth-parts";

type AuthText = Dictionary["auth"];

const POLL_INTERVAL_MS = 5_000;
const POLL_WINDOW_MS = 2 * 60 * 1000;
const idle: FormState = { status: "idle" };

/**
 * Under a code field: polls the delivery state every 5 seconds for 2 minutes, shows the "email is
 * delayed" notice when the send failed or has been queued for a minute, and offers a resend that
 * stays disabled (with a visible countdown) until the cooldown ends.
 */
export function CodeDelivery({
  purpose,
  t,
}: {
  purpose: "email_verify" | "password_reset";
  t: AuthText;
}) {
  const trpc = useTRPC();
  const [mountedAt] = useState(() => Date.now());
  const [resentAt, setResentAt] = useState<number | undefined>(undefined);
  const pollFrom = resentAt ?? mountedAt;
  const status = useQuery(
    trpc.auth.codeStatus.queryOptions(
      { purpose },
      {
        refetchInterval: () => (Date.now() - pollFrom < POLL_WINDOW_MS ? POLL_INTERVAL_MS : false),
      },
    ),
  );
  const [state, action] = useActionState(resendCodeAction, idle);
  const { refetch } = status;
  useEffect(() => {
    if (state.status !== "success") return;
    setResentAt(Date.now());
    document.getElementById(CODE_FIELD_ID)?.focus();
    void refetch();
  }, [state, refetch]);

  const reopensAt = Math.max(
    status.data?.canResendAt ?? 0,
    state.retryAt ?? 0,
    resentAt === undefined ? 0 : resentAt + CODE_RESEND_COOLDOWN_MS,
  );
  const block = useRetryBlock(reopensAt || undefined, t);
  const delayed =
    status.data?.status === "failed" || (status.data?.status === "queued" && !block.blocked);

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      {delayed ? <Alert tone="warning">{t.states.emailDelayed}</Alert> : null}
      {state.status !== "idle" && state.message ? (
        <Alert tone={state.status === "error" ? "danger" : "info"}>{state.message}</Alert>
      ) : null}
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="purpose" value={purpose} />
        <SubmitButton variant="secondary" disabled={block.blocked} disabledReason={block.reason}>
          {t.verify.resend}
        </SubmitButton>
      </form>
    </div>
  );
}
