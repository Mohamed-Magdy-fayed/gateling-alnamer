"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { Dictionary } from "@/i18n/ar";
import { acceptTermsAction } from "@/server/catalog/teachers/actions";
import { Alert, Button, Card, LoadingSwap } from "@/ui";

type TeachersText = Dictionary["teachers"];

type Props = {
  t: TeachersText;
  versionId: string;
  /** The terms in the reader's language (or the other one when only that exists). */
  body: string;
  isPlaceholder: boolean;
};

/** The current teacher terms with the accept button (C1); authoring opens once accepted. */
export function TermsCard({ t, versionId, body, isPlaceholder }: Props) {
  const router = useRouter();
  const headingId = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function accept() {
    setError(null);
    start(async () => {
      const result = await acceptTermsAction(versionId);
      if (result.ok) {
        router.refresh();
        return;
      }
      setError(result.reason === "stale" ? t.terms.stale : t.terms.error);
      if (result.reason === "stale") router.refresh();
    });
  }

  return (
    <Card className="flex max-w-2xl flex-col gap-4 p-6">
      <h2 id={headingId} className="text-lg font-semibold">
        {t.terms.title}
      </h2>
      <p className="text-sm text-fg-2">{t.terms.intro}</p>
      {isPlaceholder ? <Alert tone="warning">{t.terms.placeholder}</Alert> : null}
      {/* The terms flow with the page (no inner scroll box, so no extra tab stop is needed). */}
      <section
        aria-labelledby={headingId}
        className="rounded-sm border border-border bg-muted/40 p-4 text-sm leading-7 whitespace-pre-line"
      >
        <bdi>{body}</bdi>
      </section>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button type="button" size="lg" onClick={accept} disabled={pending} aria-busy={pending}>
        <LoadingSwap pending={pending}>{t.terms.accept}</LoadingSwap>
      </Button>
    </Card>
  );
}
