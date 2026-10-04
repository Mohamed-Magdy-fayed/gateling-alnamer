import type { ComponentProps } from "react";
import { cn, describedBy, FieldFrame } from "@/ui";

type Props = ComponentProps<"textarea"> & {
  label: string;
  hint?: string;
  error?: string;
};

/** A multi-line field with the same frame as `Field`: label, hint, inline error, aria wiring. */
export function TextAreaField({ label, hint, error, id, name, className, ...props }: Props) {
  const fieldId = id ?? `field-${name}`;
  return (
    <FieldFrame id={fieldId} label={label} hint={hint} error={error}>
      <textarea
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, { hint, error })}
        className={cn(
          "min-h-32 w-full rounded-sm border border-input bg-card px-3 py-2 text-foreground",
          "focus-visible:border-primary aria-invalid:border-destructive",
          className,
        )}
        {...props}
      />
    </FieldFrame>
  );
}
