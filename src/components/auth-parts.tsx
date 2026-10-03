"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/i18n/ar";
import { format } from "@/i18n/config";
import { formatCountdown } from "@/lib/countdown";
import type { FormState, MessageTone } from "@/server/auth/actions";
import { Alert } from "@/ui";

export type AuthText = Dictionary["auth"];

/** The resting form state every auth form starts from. */
export const idle: FormState = { status: "idle" };

/** A text link on an auth screen: underline on hover, and a 44px-tall hit area (DESIGN.md section 8). */
export const linkClass =
  "inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline";
const summaryLinkClass =
  "inline-flex min-h-11 items-center font-medium underline underline-offset-4";

/** Focuses the field a summary entry points at (a plain fragment jump does not focus buttons). */
function FieldLink({ field, children }: { field: string; children: string }) {
  const id = `field-${field}`;
  return (
    <a
      href={`#${id}`}
      className={summaryLinkClass}
      onClick={(event) => {
        event.preventDefault();
        document.getElementById(id)?.focus();
      }}
    >
      {children}
    </a>
  );
}

function toneOf(state: FormState): MessageTone {
  return state.tone ?? (state.status === "error" ? "danger" : "success");
}

/**
 * Form-level result. After every submit it takes focus (a `tabIndex={-1}` alert) so keyboard and
 * screen-reader users land on the outcome; field-format errors are listed as links to the fields.
 */
export function Message({ state, t, id }: { state: FormState; t: AuthText; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status !== "idle") ref.current?.focus();
  }, [state]);
  if (state.status === "idle" || !state.message) return null;
  const failing = Object.entries(state.fieldErrors ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return (
    <Alert ref={ref} id={id} tabIndex={-1} tone={toneOf(state)}>
      {state.message}
      {state.offerReset ? (
        <>
          {" "}
          <Link href="/forgot-password" className={linkClass}>
            {t.signIn.forgot}
          </Link>
        </>
      ) : null}
      {state.offerVerify ? (
        <>
          {" "}
          <Link href="/verify-email" className={summaryLinkClass}>
            {t.verify.bannerAction}
          </Link>
        </>
      ) : null}
      {failing.length > 0 ? (
        <ul className="mt-1 list-disc ps-5">
          {failing.map(([field, message]) => (
            <li key={field}>
              <FieldLink field={field}>{message}</FieldLink>
            </li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}

const COUNTDOWN_TICK_MS = 1000;

/**
 * From a lockout, rate-limit or resend-cooldown time until it ends: whether the submit stays
 * disabled, and the countdown text to show under it ("You can try again in 9:42").
 */
export function useRetryBlock(
  retryAt: number | undefined,
  t: AuthText,
): { blocked: boolean; reason?: string } {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const update = () =>
      setRemaining(retryAt === undefined ? 0 : Math.max(0, retryAt - Date.now()));
    update();
    if (retryAt === undefined) return;
    const timer = setInterval(update, COUNTDOWN_TICK_MS);
    return () => clearInterval(timer);
  }, [retryAt]);
  if (remaining <= 0) return { blocked: false };
  return {
    blocked: true,
    reason: format(t.states.retryCountdown, { time: formatCountdown(remaining) }),
  };
}
