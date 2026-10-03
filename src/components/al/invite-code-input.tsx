"use client";

import type { ComponentProps, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { INVITE_CODE_LENGTH, reformatInviteWithCaret } from "@/lib/invite-code";
import { cn } from "@/lib/utils";
import { describedBy, FieldFrame } from "@/ui";

/** Room for a paste with a dash or spaces; the value is reformatted to XXXX-XXXX anyway. */
const MAX_TYPED = INVITE_CODE_LENGTH + 4;

type InviteCodeInputProps = Omit<
  ComponentProps<"input">,
  "type" | "inputMode" | "maxLength" | "dir" | "autoCapitalize"
> & {
  name: string;
  label: string;
  hint?: ReactNode;
  error?: string;
};

/**
 * One input for the 8-character parent link code. Accepts lower case, spaces and Arabic-Indic
 * digits and shows the value as `XXXX-XXXX`. The value is an LTR island aligned to the start edge.
 */
export function InviteCodeInput({
  name,
  label,
  hint,
  error,
  id = `field-${name}`,
  className,
  onChange,
  ...props
}: InviteCodeInputProps) {
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <Input
        {...props}
        id={id}
        name={name}
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={MAX_TYPED}
        dir="ltr"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { hint, error })}
        className={cn("font-mono tabular text-start tracking-[0.2em]", className)}
        onChange={(event) => {
          const input = event.currentTarget;
          const next = reformatInviteWithCaret(
            input.value,
            input.selectionStart ?? input.value.length,
          );
          if (next.value !== input.value) {
            input.value = next.value;
            input.setSelectionRange(next.caret, next.caret);
          }
          onChange?.(event);
        }}
      />
    </FieldFrame>
  );
}
