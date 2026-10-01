import type { ComponentProps } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-[var(--radius-md)] border border-line bg-raised shadow-e1", className)}
      {...props}
    />
  );
}
