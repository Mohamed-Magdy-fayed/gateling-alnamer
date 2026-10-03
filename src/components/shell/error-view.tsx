"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { EmptyState } from "@/components/al/empty-state";
import { errorTitle, useErrorTexts } from "@/components/shell/error-texts";
import { Button, ButtonLink } from "@/ui";

/**
 * The body of a route error: one sentence, a retry that re-renders the segment and, when `withHome`
 * (the full-page fallback, no shell around it), a way back home. Logs the digest only.
 */
export function ErrorView({
  error,
  reset,
  withHome,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  withHome: boolean;
}) {
  const texts = useErrorTexts();
  useEffect(() => {
    console.error("route error", error.digest ?? "no digest");
  }, [error.digest]);
  return (
    <EmptyState
      icon={TriangleAlert}
      headingLevel="h1"
      title={errorTitle(texts)}
      action={
        <div className="flex flex-wrap gap-2">
          <Button onClick={reset}>{texts?.retry}</Button>
          {withHome ? (
            <ButtonLink href="/" variant="outline">
              {texts?.home}
            </ButtonLink>
          ) : null}
        </div>
      }
    />
  );
}
