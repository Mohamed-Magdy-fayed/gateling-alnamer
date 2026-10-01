import type { ReactNode } from "react";
import { Badge as BaseBadge } from "@/components/ui/badge";

// `accent` is the demo-era name of the saffron `highlight` tone.
type Tone = "neutral" | "primary" | "accent" | "success" | "warning" | "danger" | "info";

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
    <BaseBadge variant={tone === "accent" ? "highlight" : tone} className={className}>
      {children}
    </BaseBadge>
  );
}
