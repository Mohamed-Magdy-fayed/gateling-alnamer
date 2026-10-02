import type { ReactNode } from "react";
import { Badge as BaseBadge } from "@/components/ui/badge";

type Tone = "neutral" | "primary" | "highlight" | "success" | "warning" | "danger" | "info";

export function Badge({
  tone = "neutral",
  className,
  children,
  "data-testid": testId,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <BaseBadge variant={tone} className={className} data-testid={testId}>
      {children}
    </BaseBadge>
  );
}
