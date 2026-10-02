import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { AlertDescription, Alert as BaseAlert } from "@/components/ui/alert";

type Tone = "info" | "success" | "warning" | "danger";

const icons = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert };

type AlertProps = {
  tone?: Tone;
  children: ReactNode;
  /** Pass `ref` and `tabIndex={-1}` to move focus here after a submit; a focused alert is read once. */
  ref?: Ref<HTMLDivElement>;
  tabIndex?: number;
  /** Lets a control point at this alert with `aria-describedby`. */
  id?: string;
};

/** Danger interrupts (`alert`) unless the alert takes focus, where focus already announces it. */
function roleFor(tone: Tone, focusable: boolean): "alert" | "status" | undefined {
  if (tone !== "danger") return "status";
  return focusable ? undefined : "alert";
}

export function Alert({ tone = "info", children, ref, tabIndex, id }: AlertProps) {
  const Icon = icons[tone];
  return (
    <BaseAlert
      ref={ref}
      id={id}
      tabIndex={tabIndex}
      variant={tone}
      role={roleFor(tone, tabIndex !== undefined)}
      className="focus-visible:outline-2 focus-visible:outline-focus"
    >
      <Icon aria-hidden className="mt-1 size-4 shrink-0" strokeWidth={1.75} />
      <AlertDescription>{children}</AlertDescription>
    </BaseAlert>
  );
}
