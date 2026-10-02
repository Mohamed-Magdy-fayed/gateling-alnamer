"use client";

import { LoaderCircle } from "lucide-react";
import { useId } from "react";
import { useFormStatus } from "react-dom";
import { buttonClasses } from "./button";
import { cn } from "./cn";

type SubmitButtonProps = {
  children: string;
  className?: string;
  disabled?: boolean;
  /** Visible reason shown under a disabled button (touch has no tooltip), e.g. a retry countdown. */
  disabledReason?: string;
  /** `secondary` for a side action next to the primary submit (e.g. resend a code). */
  variant?: "primary" | "secondary";
};

export function SubmitButton({
  children,
  className,
  disabled = false,
  disabledReason,
  variant = "primary",
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  const reasonId = useId();
  const reason = disabled ? disabledReason : undefined;
  return (
    <>
      <button
        type="submit"
        disabled={pending || disabled}
        aria-busy={pending}
        aria-describedby={reason ? reasonId : undefined}
        className={cn(buttonClasses(variant, "lg"), "w-full", className)}
      >
        {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
        {children}
      </button>
      {reason ? (
        <p id={reasonId} className="-mt-2 text-center text-sm text-fg-muted">
          {reason}
        </p>
      ) : null}
    </>
  );
}
