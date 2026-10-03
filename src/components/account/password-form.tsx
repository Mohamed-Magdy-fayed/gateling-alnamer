"use client";

import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { PasswordInput } from "@/components/al/password-input";
import { type AuthText, idle, Message } from "@/components/auth-parts";
import type { Dictionary } from "@/i18n/ar";
import { useTRPC } from "@/lib/trpc/client";
import type { FormState } from "@/server/auth/actions";
import { Button, LoadingSwap } from "@/ui";
import { accountErrorState } from "./error-state";

type AccountText = Dictionary["account"];

type Props = { t: AccountText; authT: AuthText };

/** Current and new password. Success signs the other sessions out and keeps this one. */
export function PasswordForm({ t, authT }: Props) {
  const trpc = useTRPC();
  const mutation = useMutation(trpc.account.changePassword.mutationOptions());
  const [outcome, setOutcome] = useState<"changed" | FormState>(idle);
  const state = useMemo<FormState>(
    () => (outcome === "changed" ? { status: "success", message: t.passwordChanged } : outcome),
    [outcome, t.passwordChanged],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    mutation.mutate(
      { current: String(data.get("current") ?? ""), next: String(data.get("next") ?? "") },
      {
        onSuccess: () => {
          form.reset();
          setOutcome("changed");
        },
        onError: (error) => setOutcome(accountErrorState(error, authT, "password")),
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-md flex-col gap-4">
      <Message state={state} t={authT} />
      <PasswordInput
        name="current"
        label={t.currentPassword}
        toggleLabel={authT.fields.showPassword}
        autoComplete="current-password"
        required
      />
      <PasswordInput
        name="next"
        id="field-password"
        error={state.fieldErrors?.password}
        label={t.newPassword}
        hint={authT.fields.passwordHint}
        toggleLabel={authT.fields.showPassword}
        autoComplete="new-password"
        required
      />
      <Button type="submit" size="lg" disabled={mutation.isPending} aria-busy={mutation.isPending}>
        <LoadingSwap pending={mutation.isPending}>{t.changePassword}</LoadingSwap>
      </Button>
    </form>
  );
}
