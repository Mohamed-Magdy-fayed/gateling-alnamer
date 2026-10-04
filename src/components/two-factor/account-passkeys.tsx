"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addPasskeyFinishAction,
  addPasskeyOptionsAction,
  removePasskeyAction,
} from "@/app/two-factor/actions";
import type { Dictionary } from "@/i18n/ar";
import { format } from "@/i18n/config";
import { Alert, Button, LoadingSwap } from "@/ui";

type TwoFactorText = Dictionary["twoFactor"];

export type PasskeyItem = { id: string; addedText: string };

/** Account page (staff): the account's passkeys, add one, remove one. */
export function AccountPasskeys({ t, items }: { t: TwoFactorText; items: PasskeyItem[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    setMessage(null);
    startTransition(async () => {
      try {
        const optionsJSON = await addPasskeyOptionsAction();
        if (!optionsJSON) {
          setMessage({ tone: "danger", text: t.passkeyFailed });
          return;
        }
        const response = await startRegistration({ optionsJSON });
        const result = await addPasskeyFinishAction(response);
        setMessage(
          result.ok
            ? { tone: "success", text: t.passkeyAdded }
            : { tone: "danger", text: t.passkeyFailed },
        );
        router.refresh();
      } catch {
        setMessage({ tone: "danger", text: t.passkeyFailed });
      }
    });
  }

  function remove(id: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await removePasskeyAction(id);
      if (!result.ok) setMessage({ tone: "danger", text: t.error });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-semibold">{t.passkeysTitle}</h3>
      <p className="text-sm text-fg-2">{t.passkeysIntro}</p>
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">{t.noPasskeys}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{format(t.passkeyLabel, { date: item.addedText })}</span>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11"
                disabled={pending}
                onClick={() => remove(item.id)}
              >
                {t.removePasskey}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" className="min-h-11 self-start" disabled={pending} onClick={add}>
        <LoadingSwap pending={pending}>{t.addPasskey}</LoadingSwap>
      </Button>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
    </div>
  );
}
