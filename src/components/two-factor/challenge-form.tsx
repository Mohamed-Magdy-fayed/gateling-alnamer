"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { challengeAction } from "@/app/two-factor/actions";
import { CodeInput } from "@/components/al/code-input";
import { linkClass } from "@/components/auth-parts";
import type { Dictionary } from "@/i18n/ar";
import { Button, Field, LoadingSwap } from "@/ui";

type TwoFactorText = Dictionary["twoFactor"];

/** The sign-in challenge: the app code, or a recovery code; then on to where the user was going. */
export function ChallengeForm({ t, next }: { t: TwoFactorText; next: string }) {
  const router = useRouter();
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await challengeAction(value);
      if (result.ok) {
        router.replace(next);
        router.refresh();
        return;
      }
      setError(
        result.reason === "locked" ? t.locked : result.reason === "invalid" ? t.invalid : t.error,
      );
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {useRecovery ? (
        <Field
          name="recovery"
          label={t.recoveryLabel}
          error={error ?? undefined}
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          autoComplete="off"
          ltr
        />
      ) : (
        <CodeInput
          name="code"
          label={t.codeLabel}
          error={error ?? undefined}
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          focusOnMount
        />
      )}
      <Button
        type="submit"
        size="lg"
        className="self-start"
        disabled={pending || value.trim() === ""}
      >
        <LoadingSwap pending={pending}>{t.verify}</LoadingSwap>
      </Button>
      <div className="flex flex-wrap gap-x-6">
        <button
          type="button"
          className={linkClass}
          onClick={() => {
            setUseRecovery((current) => !current);
            setValue("");
            setError(null);
          }}
        >
          {useRecovery ? t.useCode : t.useRecovery}
        </button>
        <Link href="/two-factor/lost" className={linkClass}>
          {t.lost}
        </Link>
      </div>
    </form>
  );
}
