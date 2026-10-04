"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  challengeAction,
  passkeyOptionsAction,
  passkeyVerifyAction,
} from "@/app/two-factor/actions";
import { CodeInput } from "@/components/al/code-input";
import { linkClass } from "@/components/auth-parts";
import type { Dictionary } from "@/i18n/ar";
import { Button, Field, LoadingSwap } from "@/ui";

type TwoFactorText = Dictionary["twoFactor"];

/** The sign-in challenge: the app code, or a recovery code; then on to where the user was going. */
export function ChallengeForm({
  t,
  next,
  hasPasskey,
}: {
  t: TwoFactorText;
  next: string;
  /** The account has a passkey: offer it as the second factor. */
  hasPasskey: boolean;
}) {
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

  function signInWithPasskey() {
    setError(null);
    startTransition(async () => {
      try {
        const optionsJSON = await passkeyOptionsAction();
        if (!optionsJSON) {
          setError(t.passkeyFailed);
          return;
        }
        const response = await startAuthentication({ optionsJSON });
        const result = await passkeyVerifyAction(response);
        if (result.ok) {
          router.replace(next);
          router.refresh();
          return;
        }
        setError(result.reason === "locked" ? t.locked : t.passkeyFailed);
      } catch {
        // The browser dialog was cancelled or the device has no matching passkey.
        setError(t.passkeyFailed);
      }
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
      {hasPasskey ? (
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 self-start"
          disabled={pending}
          onClick={signInWithPasskey}
        >
          {t.usePasskey}
        </Button>
      ) : null}
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
