"use client";

import { useMutation } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type AuthText, Message } from "@/components/auth-parts";
import type { Dictionary } from "@/i18n/ar";
import { format, formatDate, type Locale } from "@/i18n/config";
import { useTRPC } from "@/lib/trpc/client";
import type { FormState } from "@/server/auth/actions";
import { Button, LoadingSwap } from "@/ui";
import { useResetOnRestore } from "./use-reset-on-restore";

type Texts = { orders: Dictionary["orders"]; courses: Dictionary["courses"]; auth: AuthText };

function failure(error: unknown, t: Texts): FormState {
  const limited = isTRPCClientError(error) && error.data?.code === "TOO_MANY_REQUESTS";
  return {
    status: "error",
    tone: limited ? "warning" : "danger",
    message: limited ? t.auth.states.rateLimited : t.courses.refusals.try_again,
  };
}

/** "Check again" on a pending order: asks the gateway once more, then re-renders the page. */
export function CheckAgainButton({ number, t }: { number: string; t: Texts }) {
  const trpc = useTRPC();
  const router = useRouter();
  const recheck = useMutation(trpc.orders.recheck.mutationOptions());
  const [state, setState] = useState<FormState>({ status: "idle" });
  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="secondary"
        className="min-h-11 self-start"
        disabled={recheck.isPending}
        onClick={() =>
          recheck.mutate(
            { number },
            {
              onSuccess: () => {
                setState({ status: "idle" });
                router.refresh();
              },
              onError: (error) => setState(failure(error, t)),
            },
          )
        }
      >
        <LoadingSwap pending={recheck.isPending}>{t.orders.checkAgain}</LoadingSwap>
      </Button>
      <Message state={state} t={t.auth} />
    </div>
  );
}

/** "Try again" on a failed order: starts checkout again (the same order gets a new invoice). */
export function TryAgainButton({
  courseId,
  beneficiaryId,
  label,
  locale,
  t,
}: {
  courseId: string;
  /** Set when a parent bought for a child. */
  beneficiaryId: string | null;
  label: string;
  locale: Locale;
  t: Texts;
}) {
  const trpc = useTRPC();
  const start = useMutation(trpc.orders.start.mutationOptions());
  const [state, setState] = useState<FormState>({ status: "idle" });
  const pending = start.isPending || start.isSuccess;
  useResetOnRestore(start.reset);
  return (
    <div className="flex flex-col gap-3">
      <Button
        className="min-h-11 self-start"
        disabled={pending}
        onClick={() =>
          start.mutate(
            { courseId, beneficiaryStudentId: beneficiaryId ?? undefined },
            {
              onSuccess: (result) => {
                if (result.ok) {
                  window.location.assign(result.paymentUrl);
                  return;
                }
                start.reset();
                const message =
                  result.reason === "already_has_access"
                    ? format(t.courses.refusals.already_has_access, {
                        date: formatDate(locale, new Date(result.endsAt)),
                      })
                    : result.reason === "rate_limited"
                      ? t.auth.states.rateLimited
                      : t.courses.refusals[result.reason];
                setState({ status: "error", message });
              },
              onError: (error) => setState(failure(error, t)),
            },
          )
        }
      >
        <LoadingSwap pending={pending}>{label}</LoadingSwap>
      </Button>
      <Message state={state} t={t.auth} />
    </div>
  );
}
