"use client";

import { useMutation } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { CodeInput } from "@/components/al/code-input";
import { type AuthText, idle, Message } from "@/components/auth-parts";
import type { Dictionary } from "@/i18n/ar";
import { useTRPC } from "@/lib/trpc/client";
import type { FormState } from "@/server/auth/actions";
import { Button, Field, Ltr } from "@/ui";
import { accountErrorState } from "./error-state";

type AccountText = Dictionary["account"];

type Props = {
  t: AccountText;
  authT: AuthText;
  /** The confirmed email, or null for an account that has none (a parent-created child). */
  email: string | null;
};

type Step = "address" | "code";
type Outcome = "codeSent" | "added" | FormState;

function Spinner({ busy }: { busy: boolean }) {
  return busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null;
}

/** Shows the email, or walks an account without one through address, code and confirmation. */
export function EmailSection({ t, authT, email }: Props) {
  const router = useRouter();
  const trpc = useTRPC();
  const add = useMutation(trpc.account.addEmail.mutationOptions());
  const verify = useMutation(trpc.account.verifyAddedEmail.mutationOptions());
  const [step, setStep] = useState<Step>("address");
  const [outcome, setOutcome] = useState<Outcome>(idle);
  const state = useMemo<FormState>(() => {
    if (outcome === "codeSent") return { status: "success", message: t.emailCodeSent };
    if (outcome === "added") return { status: "success", message: t.emailAdded };
    return outcome;
  }, [outcome, t.emailCodeSent, t.emailAdded]);

  function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    add.mutate(
      { email: address },
      {
        onSuccess: () => {
          setStep("code");
          setOutcome("codeSent");
        },
        onError: (error) => setOutcome(accountErrorState(error, authT)),
      },
    );
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    verify.mutate(
      { code },
      {
        onSuccess: () => {
          setOutcome("added");
          router.refresh();
        },
        onError: (error) => setOutcome(accountErrorState(error, authT)),
      },
    );
  }

  if (email) {
    return (
      <div className="flex flex-col gap-3">
        <Message state={state} t={authT} />
        <p className="break-words">
          <Ltr wrap>{email}</Ltr>
        </p>
      </div>
    );
  }

  return (
    <div className="flex max-w-md flex-col gap-4">
      <h3 className="text-base font-medium">{t.addEmail}</h3>
      <p className="text-sm text-fg-2">{t.emailNone}</p>
      <Message state={state} t={authT} />
      {step === "address" ? (
        <form onSubmit={sendCode} noValidate className="flex flex-col gap-4">
          <Field
            name="email"
            type="email"
            label={authT.fields.email}
            autoComplete="email"
            ltr
            required
          />
          <Button type="submit" size="lg" disabled={add.isPending} aria-busy={add.isPending}>
            <Spinner busy={add.isPending} />
            {t.sendCode}
          </Button>
        </form>
      ) : (
        <form onSubmit={confirm} noValidate className="flex flex-col gap-4">
          <CodeInput name="code" label={authT.fields.code} focusOnMount required />
          <Button type="submit" size="lg" disabled={verify.isPending} aria-busy={verify.isPending}>
            <Spinner busy={verify.isPending} />
            {authT.verify.submit}
          </Button>
          <Button type="button" variant="outline" size="lg" onClick={() => setStep("address")}>
            {authT.verify.resend}
          </Button>
        </form>
      )}
    </div>
  );
}
