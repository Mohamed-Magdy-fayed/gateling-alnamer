import type { ReactNode } from "react";
import { Badge as BaseBadge } from "@/components/ui/badge";

type Tone = "neutral" | "primary" | "highlight" | "success" | "warning" | "danger" | "info";

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <BaseBadge variant={tone} className={className}>
      {children}
    </BaseBadge>
  );
}
