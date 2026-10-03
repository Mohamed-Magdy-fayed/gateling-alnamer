"use client";

import { ErrorView } from "@/components/shell/error-view";
import { Container } from "@/ui";

/** Fallback for a failure above the dashboard shell (the layout itself): retry and a home link. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" tabIndex={-1} className="py-8 focus:outline-none">
      <Container>
        <ErrorView error={error} reset={reset} withHome />
      </Container>
    </main>
  );
}
