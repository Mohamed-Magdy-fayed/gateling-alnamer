"use client";

import { Eye, EyeOff } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { describedBy, FieldFrame } from "@/ui";

type PasswordInputProps = Omit<ComponentProps<"input">, "type"> & {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  /** Constant accessible name of the toggle (the state is `aria-pressed`), from the dictionary. */
  toggleLabel: string;
};

/** Password field with a show/hide toggle. The value is an LTR island aligned to the start edge. */
export function PasswordInput({
  name,
  label,
  hint,
  error,
  toggleLabel,
  id,
  className,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const fieldId = id ?? `field-${name}`;
  const Icon = visible ? EyeOff : Eye;
  return (
    <FieldFrame id={fieldId} label={label} hint={hint} error={error}>
      <div dir="ltr" className="relative">
        <Input
          id={fieldId}
          name={name}
          type={visible ? "text" : "password"}
          dir="ltr"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fieldId, { hint, error })}
          className={cn("pe-12 text-start", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={toggleLabel}
          aria-pressed={visible}
          className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Icon aria-hidden className="size-4" strokeWidth={1.75} />
        </button>
      </div>
    </FieldFrame>
  );
}
