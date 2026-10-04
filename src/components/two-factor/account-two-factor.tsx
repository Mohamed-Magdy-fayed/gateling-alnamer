"use client";

import { useState, useTransition } from "react";
import { regenerateCodesAction } from "@/app/two-factor/actions";
import { CodeInput } from "@/components/al/code-input";
import type { Dictionary } from "@/i18n/ar";
import { format, type Locale, plural } from "@/i18n/config";
import { Button, LoadingSwap, Ltr } from "@/ui";

type TwoFactorText = Dictionary["twoFactor"];

type Props = {
  t: TwoFactorText;
  locale: Locale;
  /** Preformatted date two-factor was set up. */
  since: string;
  recoveryLeft: number;
};

/** Account page (staff): two-factor status, codes left, and new recovery codes behind an app code. */
export function AccountTwoFactor({ t, locale, since, recoveryLeft }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();

  function regenerate() {
    setError(null);
    startTransition(async () => {
      const result = await regenerateCodesAction(code);
      if (result.ok) {
        setCodes(result.recoveryCodes ?? []);
        setCode("");
        return;
      }
      setError(
        result.reason === "locked" ? t.locked : result.reason === "invalid" ? t.invalid : t.error,
      );
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-2">
        {format(t.accountOn, { date: since })} {plural(locale, t.recoveryLeft, recoveryLeft)}
      </p>
      {codes ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{t.codesIntro}</p>
          <ul className="grid grid-cols-2 gap-2 rounded-[var(--radius-md)] bg-sunken p-4 font-mono text-sm">
            {codes.map((value) => (
              <li key={value}>
                <Ltr>{value}</Ltr>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            regenerate();
          }}
        >
          <CodeInput
            id="field-regenerate-code"
            name="code"
            label={t.codeLabel}
            hint={t.regenerateHint}
            error={error ?? undefined}
            value={code}
            onChange={(event) => setCode(event.currentTarget.value)}
          />
          <Button
            type="submit"
            variant="secondary"
            className="min-h-11 self-start"
            disabled={pending || code.length !== 6}
          >
            <LoadingSwap pending={pending}>{t.regenerate}</LoadingSwap>
          </Button>
        </form>
      )}
    </div>
  );
}
