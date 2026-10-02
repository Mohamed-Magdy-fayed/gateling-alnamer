"use client";

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function RadioGroup({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-2", className)}
      {...props}
    />
  );
}

/** Card variant: the whole item is the hit area and carries the label text. */
function RadioGroupItem({
  className,
  children,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "flex min-h-11 items-center justify-center rounded-md border border-input bg-card px-3 text-sm font-medium text-foreground",
        "focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-55",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary-soft data-[state=checked]:text-primary-soft-fg",
        className,
      )}
      {...props}
    >
      {children}
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };
