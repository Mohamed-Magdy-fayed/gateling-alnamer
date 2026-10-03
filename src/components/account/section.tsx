import type { ReactNode } from "react";
import { Card } from "@/ui";

type Props = { id: string; title: string; children: ReactNode };

/** One account section: a named region with its h2, in a single Card (never nested). */
export function AccountSection({ id, title, children }: Props) {
  const headingId = `account-${id}`;
  return (
    <section aria-labelledby={headingId}>
      <Card className="flex flex-col gap-4 p-6">
        <h2
          id={headingId}
          tabIndex={-1}
          className="text-lg font-semibold focus-visible:outline-2 focus-visible:outline-focus"
        >
          {title}
        </h2>
        {children}
      </Card>
    </section>
  );
}
