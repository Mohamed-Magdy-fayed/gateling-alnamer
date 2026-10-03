"use client";

import { ErrorView } from "@/components/shell/error-view";
import { Container } from "@/ui";

/** A dashboard page failed: the shell (header, nav) stays and only the page area shows the error. */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Container className="py-8">
      <ErrorView error={error} reset={reset} withHome={false} />
    </Container>
  );
}
