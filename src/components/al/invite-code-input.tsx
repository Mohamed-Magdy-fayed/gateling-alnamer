"use client";

import { type ComponentProps, useRef } from "react";
import { Input } from "@/components/ui/input";
import { toLatinDigits } from "@/lib/digits";
import { cn } from "@/lib/utils";
import { describedBy, FieldFrame } from "@/ui";

const CODE_LENGTH = 8;
const GROUP_LENGTH = 4;
/** Room for a paste with a dash or spaces; the value is reformatted to XXXX-XXXX anyway. */
const MAX_TYPED = CODE_LENGTH + 4;

/** What a person typed or pasted as `XXXX-XXXX`: Arabic-Indic digits mapped, upper case, no spaces or dashes. */
export function formatInviteInput(raw: string): string {
  const compact = toLatinDigits(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_LENGTH);
  return compact.length > GROUP_LENGTH
    ? `${compact.slice(0, GROUP_LENGTH)}-${compact.slice(GROUP_LENGTH)}`
    : compact;
}

type InviteCodeInputProps = Omit<
  ComponentProps<"input">,
  "type" | "inputMode" | "maxLength" | "dir" | "autoCapitalize"
> & {
  name: string;
  label: string;
  hint?: string;
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
  const ref = useRef<HTMLInputElement>(null);
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <Input
        {...props}
        ref={ref}
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
          const formatted = formatInviteInput(event.currentTarget.value);
          if (formatted !== event.currentTarget.value) event.currentTarget.value = formatted;
          onChange?.(event);
        }}
      />
    </FieldFrame>
  );
}
