import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, Card, cn } from "@/ui";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  /** One line that says why it is empty or what comes next. */
  body?: string;
  /** The one action that fixes the empty state. Absent on "coming soon" cards, which are never links. */
  action?: ReactNode;
  /** Label for the "coming in the full test version" pill; set it to mark a planned feature. */
  comingSoon?: string;
  /** Heading level of the title; pick the one that follows the section heading. */
  headingLevel?: "h1" | "h2" | "h3";
  className?: string;
};

/**
 * Empty or not-built-yet card (DESIGN section 8). Planned features pass `comingSoon` and no
 * `action`, so the card stays inert.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  comingSoon,
  headingLevel: Heading = "h2",
  className,
}: EmptyStateProps) {
  return (
    <Card className={cn("flex flex-col items-start gap-3 p-6", className)}>
      <span
        aria-hidden
        className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg"
      >
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <Heading className="text-lg font-semibold">{title}</Heading>
      {body ? <p className="max-w-prose text-sm text-fg-2">{body}</p> : null}
      {comingSoon ? <Badge tone="highlight">{comingSoon}</Badge> : null}
      {action}
    </Card>
  );
}
