"use client";

import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/al/empty-state";
import { useErrorTexts } from "@/components/shell/error-texts";
import { Button, Container } from "@/ui";

/** Route error for every signed-in page: one sentence and a retry that re-renders the segment. */
export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const texts = useErrorTexts();
  return (
    <main id="main" className="py-8">
      <Container>
        <EmptyState
          icon={TriangleAlert}
          headingLevel="h1"
          title={texts?.message ?? ""}
          action={<Button onClick={reset}>{texts?.retry}</Button>}
        />
      </Container>
    </main>
  );
}
