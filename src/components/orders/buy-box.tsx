"use client";

import { useMutation } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { useId, useState } from "react";
import { type AuthText, Message } from "@/components/auth-parts";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { Dictionary } from "@/i18n/ar";
import { dirOf, format, formatDate, type Locale } from "@/i18n/config";
import { useTRPC } from "@/lib/trpc/client";
import type { FormState } from "@/server/auth/actions";
import type { CheckoutResult } from "@/server/orders/checkout";
import { Button, LoadingSwap } from "@/ui";
import { useResetOnRestore } from "./use-reset-on-restore";

export type BuyChildOption = {
  id: string;
  name: string;
  /** Preformatted access end when the child already has access (the option is then disabled). */
  accessUntil: string | null;
};

type Props = {
  courseId: string;
  locale: Locale;
  t: CoursesText;
  authT: AuthText;
  /** A student buys for themself; a parent picks one of their children. */
  beneficiaries?: BuyChildOption[];
};

type CoursesText = Dictionary["courses"];

const NO_FORM = "buy-box-no-form";

function refusalMessage(
  result: Exclude<CheckoutResult, { ok: true }>,
  t: CoursesText,
  locale: Locale,
): string {
  if (result.reason === "already_has_access") {
    const date = formatDate(locale, new Date(result.endsAt));
    return format(t.refusals.already_has_access, { date });
  }
  if (result.reason === "rate_limited") return t.refusals.try_again;
  return t.refusals[result.reason];
}

/** "Buy course" (or "Buy for <child>"): starts checkout, then hands over to the payment page. */
export function BuyBox({ courseId, locale, t, authT, beneficiaries }: Props) {
  const trpc = useTRPC();
  const start = useMutation(trpc.orders.start.mutationOptions());
  const [state, setState] = useState<FormState>({ status: "idle" });
  const legendId = useId();
  const firstFree = beneficiaries?.find((child) => child.accessUntil === null)?.id ?? "";
  const [picked, setPicked] = useState(firstFree);
  const pickedChild = beneficiaries?.find((child) => child.id === picked);
  const pending = start.isPending || start.isSuccess;
  useResetOnRestore(start.reset);

  function buy() {
    setState({ status: "idle" });
    start.mutate(
      { courseId, beneficiaryStudentId: beneficiaries ? picked : undefined },
      {
        onSuccess: (result) => {
          if (result.ok) {
            window.location.assign(result.paymentUrl);
            return;
          }
          start.reset();
          setState({ status: "error", message: refusalMessage(result, t, locale) });
        },
        onError: (error) => {
          const limited = isTRPCClientError(error) && error.data?.code === "TOO_MANY_REQUESTS";
          setState({
            status: "error",
            tone: limited ? "warning" : "danger",
            message: limited ? authT.states.rateLimited : t.refusals.try_again,
          });
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {beneficiaries ? (
        <fieldset className="flex flex-col gap-2">
          <legend id={legendId} className="mb-2 text-sm font-medium">
            {t.chooseChild}
          </legend>
          <RadioGroup
            form={NO_FORM}
            dir={dirOf(locale)}
            value={picked}
            onValueChange={setPicked}
            aria-labelledby={legendId}
          >
            {beneficiaries.map((child) => (
              <RadioGroupItem
                key={child.id}
                value={child.id}
                disabled={child.accessUntil !== null}
                className="justify-start py-2 text-start"
              >
                <span className="flex flex-col">
                  <bdi>{child.name}</bdi>
                  {child.accessUntil ? (
                    <span className="text-xs font-normal text-fg-muted">
                      {format(t.childHasAccess, { date: child.accessUntil })}
                    </span>
                  ) : null}
                </span>
              </RadioGroupItem>
            ))}
          </RadioGroup>
        </fieldset>
      ) : null}
      <Button
        size="lg"
        onClick={buy}
        disabled={pending || (beneficiaries !== undefined && !pickedChild)}
        aria-describedby={state.status === "idle" ? undefined : "buy-message"}
      >
        <LoadingSwap pending={pending}>
          {pickedChild ? format(t.buyForChild, { name: pickedChild.name }) : t.buy}
        </LoadingSwap>
      </Button>
      <Message state={state} t={authT} id="buy-message" />
    </div>
  );
}
