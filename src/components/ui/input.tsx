import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        "min-h-11 w-full rounded-sm border border-input bg-card px-3 text-foreground placeholder:text-muted-foreground",
        "focus-visible:border-primary aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
