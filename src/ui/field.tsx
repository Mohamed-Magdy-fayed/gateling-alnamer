import type { ComponentProps } from "react";
import { cn } from "./cn";

type FieldProps = ComponentProps<"input"> & {
  label: string;
  hint?: string;
  /** LTR island (emails, codes, passwords). */
  ltr?: boolean;
};

export function Field({ label, hint, ltr, id, name, className, ...props }: FieldProps) {
  const fieldId = id ?? `field-${name}`;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-fg">
        {label}
      </label>
      <input
        id={fieldId}
        name={name}
        dir={ltr ? "ltr" : undefined}
        aria-describedby={hintId}
        className={cn(
          "min-h-11 w-full rounded-[var(--radius-sm)] border border-line-strong bg-raised px-3 text-fg placeholder:text-fg-muted",
          "focus-visible:border-primary aria-invalid:border-danger",
          className,
        )}
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
