import { Plus } from "lucide-react";
import type { Dictionary } from "@/i18n/ar";
import { format, type Locale } from "@/i18n/config";
import { Button, Card, Ltr, Progress } from "@/ui";

const children = [
  { name: { ar: "ابن تجريبي 1", en: "Sample child 1" }, courses: 3, progress: 58, quiz: 86 },
  { name: { ar: "ابن تجريبي 2", en: "Sample child 2" }, courses: 2, progress: 34, quiz: 71 },
];

export function ParentView({ t, locale }: { t: Dictionary; locale: Locale }) {
  const p = t.dashboard.parent;
  return (
    <section aria-labelledby="children">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="children" className="text-lg font-semibold">
          {p.title}
        </h2>
        <Button variant="outline" size="sm" disabled>
          <Plus aria-hidden className="size-4" strokeWidth={1.75} />
          {p.addChild}
        </Button>
      </div>
      <ul className="grid gap-4 md:grid-cols-2">
        {children.map((child) => (
          <li key={child.name.en}>
            <Card className="flex flex-col gap-4 p-5">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex size-11 items-center justify-center rounded-full bg-primary-soft font-semibold text-primary-soft-fg"
                >
                  {child.name[locale].charAt(0)}
                </span>
                <div>
                  <h3 className="font-semibold">{child.name[locale]}</h3>
                  <p className="text-sm text-fg-muted">
                    {format(p.courses, { count: child.courses })}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-fg-2">{p.averageProgress}</span>
                  <Ltr className="font-medium">{child.progress}%</Ltr>
                </div>
                <Progress value={child.progress} label={p.averageProgress} />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-fg-2">{p.lastQuiz}</span>
                <Ltr className="font-semibold text-success">{child.quiz}%</Ltr>
              </div>
              <Button variant="secondary" size="sm" disabled>
                {p.buyFor}
              </Button>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
