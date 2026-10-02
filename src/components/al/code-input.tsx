"use client";

import { type ComponentProps, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { onlyLatinDigits } from "@/lib/digits";
import { cn } from "@/lib/utils";
import { describedBy, FieldFrame } from "@/ui";

/** The id every code field carries, so a resend can move focus back to it. */
export const CODE_FIELD_ID = "field-code";
const CODE_LENGTH = 6;

type CodeInputProps = Omit<
  ComponentProps<"input">,
  "type" | "inputMode" | "autoComplete" | "maxLength" | "dir" | "pattern"
> & {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  /** Focus the field once on mount, used by the code screens after a code was sent. */
  focusOnMount?: boolean;
};

/**
 * One input for a 6-digit one-time code: numeric keypad, OS autofill from SMS or mail
 * (`one-time-code`), digits only (Arabic-Indic digits typed or pasted become 0-9). The value is an
 * LTR island aligned to the start edge.
 */
export function CodeInput({
  name,
  label,
  hint,
  error,
  focusOnMount = false,
  id = CODE_FIELD_ID,
  className,
  onChange,
  ...props
}: CodeInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <Input
        {...props}
        ref={ref}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={CODE_LENGTH}
        pattern={String.raw`\d{6}`}
        dir="ltr"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { hint, error })}
        className={cn("tabular text-start tracking-[0.4em]", className)}
        onChange={(event) => {
          const digits = onlyLatinDigits(event.currentTarget.value);
          if (digits !== event.currentTarget.value) event.currentTarget.value = digits;
          onChange?.(event);
        }}
      />
    </FieldFrame>
  );
}
