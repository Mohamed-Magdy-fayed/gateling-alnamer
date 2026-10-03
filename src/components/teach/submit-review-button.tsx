"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Dictionary } from "@/i18n/ar";
import { useTRPC } from "@/lib/trpc/client";
import { Alert, Button, LoadingSwap } from "@/ui";

type TeachText = Dictionary["teach"];

/** "Submit for review" on the teacher's own draft. */
export function SubmitReviewButton({ courseId, t }: { courseId: string; t: TeachText }) {
  const trpc = useTRPC();
  const router = useRouter();
  const submit = useMutation(trpc.teach.submit.mutationOptions());
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <Button
        className="min-h-11 self-start"
        disabled={submit.isPending}
        onClick={() =>
          submit.mutate(
            { courseId },
            {
              onSuccess: (result) => {
                setFailed(!result.ok);
                router.refresh();
              },
              onError: () => setFailed(true),
            },
          )
        }
      >
        <LoadingSwap pending={submit.isPending}>{t.submit}</LoadingSwap>
      </Button>
      {failed ? <Alert tone="danger">{t.errorGeneric}</Alert> : null}
    </div>
  );
}
