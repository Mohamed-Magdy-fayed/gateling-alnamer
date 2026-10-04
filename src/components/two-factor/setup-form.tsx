"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { confirmSetupAction, finishSetupAction } from "@/app/two-factor/actions";
import { CodeInput } from "@/components/al/code-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { Dictionary } from "@/i18n/ar";
import { Button, LoadingSwap, Ltr } from "@/ui";

type TwoFactorText = Dictionary["twoFactor"];

type Props = {
  t: TwoFactorText;
  /** Server-rendered QR code (SVG markup from the qrcode package, our own input only). */
  qrSvg: string;
  /** The base32 key, grouped for manual entry. */
  secretGroups: string;
  next: string;
};

/** Enrolment: scan, confirm with a first code, then save the recovery codes before finishing. */
export function SetupForm({ t, qrSvg, secretGroups, next }: Props) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [finish, setFinish] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmSetupAction(code);
      if (result.ok) {
        setCodes(result.recoveryCodes ?? []);
        setFinish(result.finish ?? null);
        return;
      }
      setError(
        result.reason === "locked" ? t.locked : result.reason === "invalid" ? t.invalid : t.error,
      );
    });
  }

  if (codes) {
    const text = codes.join("\n");
    const href = `data:text/plain;charset=utf-8,${encodeURIComponent(`${text}\n`)}`;
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t.codesTitle}</h2>
        <p className="text-sm text-fg-2">{t.codesIntro}</p>
        <ul
          data-testid="recovery-codes"
          className="grid grid-cols-2 gap-2 rounded-[var(--radius-md)] bg-sunken p-4 font-mono text-sm"
        >
          {codes.map((value) => (
            <li key={value}>
              <Ltr>{value}</Ltr>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            className="min-h-11"
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(() => setCopied(true));
            }}
          >
            {t.copy}
          </Button>
          <a
            href={href}
            download="al-namer-recovery-codes.txt"
            className="inline-flex min-h-11 items-center rounded-sm border border-input px-4 text-sm font-medium hover:bg-sunken"
          >
            {t.download}
          </a>
        </div>
        <p aria-live="polite" className={copied ? "text-sm text-fg-muted" : "sr-only"}>
          {copied ? t.copied : ""}
        </p>
        <Label
          htmlFor="field-saved"
          className="flex min-h-11 cursor-pointer items-center gap-3 font-normal"
        >
          <Checkbox
            id="field-saved"
            checked={saved}
            onCheckedChange={(value) => setSaved(value === true)}
          />
          <span>{t.saved}</span>
        </Label>
        <Button
          size="lg"
          className="self-start"
          disabled={!saved || pending}
          onClick={() =>
            startTransition(async () => {
              const result = await finishSetupAction(finish ?? "");
              if (result.ok) {
                router.replace(next);
                router.refresh();
              } else {
                setError(t.error);
              }
            })
          }
        >
          {t.finish}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">{t.scanStep}</p>
        <div
          role="img"
          aria-label={t.qrLabel}
          // A QR code needs a light quiet zone in both themes to scan.
          className="size-48 rounded-[var(--radius-md)] bg-white p-2"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generated on our server from our own otpauth URI.
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
        <p className="text-sm text-fg-2">{t.manualLabel}</p>
        <p className="font-mono text-base" data-testid="totp-secret">
          <Ltr>{secretGroups}</Ltr>
        </p>
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
      >
        <p className="text-sm font-medium">{t.codeStep}</p>
        <CodeInput
          name="code"
          label={t.codeLabel}
          error={error ?? undefined}
          value={code}
          onChange={(event) => setCode(event.currentTarget.value)}
        />
        <Button
          type="submit"
          size="lg"
          className="self-start"
          disabled={pending || code.length !== 6}
        >
          <LoadingSwap pending={pending}>{t.confirm}</LoadingSwap>
        </Button>
      </form>
    </div>
  );
}
