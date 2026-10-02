"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";
import { buttonClasses } from "./button";
import { cn } from "./cn";

type SubmitButtonProps = { children: string; className?: string; disabled?: boolean };

export function SubmitButton({ children, className, disabled = false }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={cn(buttonClasses("primary", "lg"), "w-full", className)}
    >
      {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
}
