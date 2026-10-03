import type { ComponentProps, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "./cn";

type FrameProps = {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
};

/** The `aria-describedby` value for a control inside a FieldFrame. */
export function describedBy(id: string, { hint, error }: { hint?: ReactNode; error?: string }) {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

/** Label, control slot, hint and an inline error (polite live region) for one field. */
export function FieldFrame({ id, label, hint, error, children }: FrameProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
      <p
        id={`${id}-error`}
        aria-live="polite"
        className={error ? "text-sm text-destructive" : "sr-only"}
      >
        {error}
      </p>
    </div>
  );
}

type FieldProps = ComponentProps<"input"> & {
  label: string;
  hint?: string;
  error?: string;
  /** LTR island (emails, usernames, codes): dir="ltr" with text at the start edge. */
  ltr?: boolean;
};

export function Field({ label, hint, error, ltr, id, name, className, ...props }: FieldProps) {
  const fieldId = id ?? `field-${name}`;
  return (
    <FieldFrame id={fieldId} label={label} hint={hint} error={error}>
      <Input
        id={fieldId}
        name={name}
        dir={ltr ? "ltr" : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, { hint, error })}
        className={cn(ltr && "text-start", className)}
        {...props}
      />
    </FieldFrame>
  );
}
