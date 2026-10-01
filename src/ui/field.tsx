import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FieldProps = ComponentProps<"input"> & {
  label: string;
  hint?: string;
  /** LTR island (emails, codes, passwords). */
  ltr?: boolean;
};

export function Field({ label, hint, ltr, id, name, ...props }: FieldProps) {
  const fieldId = id ?? `field-${name}`;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      <Input
        id={fieldId}
        name={name}
        dir={ltr ? "ltr" : undefined}
        aria-describedby={hintId}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
