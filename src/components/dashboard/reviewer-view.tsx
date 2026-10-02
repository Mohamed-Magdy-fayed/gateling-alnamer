import type { Dictionary } from "@/i18n/ar";
import { Card } from "@/ui";

export function ReviewerView({ t }: { t: Dictionary }) {
  const r = t.dashboard.reviewer;
  return (
    <section aria-labelledby="reviewer-title">
      <Card className="flex flex-col items-start gap-2 p-6">
        <h2 id="reviewer-title" className="text-lg font-semibold">
          {r.title}
        </h2>
        <p className="max-w-prose text-sm text-fg-muted">{r.body}</p>
      </Card>
    </section>
  );
}
