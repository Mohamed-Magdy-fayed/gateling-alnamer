import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { AlertDescription, Alert as BaseAlert } from "@/components/ui/alert";

type Tone = "info" | "success" | "danger";

const icons = { info: Info, success: CircleCheck, danger: CircleAlert };

type AlertProps = {
  tone?: Tone;
  children: ReactNode;
  /** Pass `ref` and `tabIndex={-1}` to move focus here after a failed submit. */
  ref?: Ref<HTMLDivElement>;
  tabIndex?: number;
};

export function Alert({ tone = "info", children, ref, tabIndex }: AlertProps) {
  const Icon = icons[tone];
  return (
    <BaseAlert
      ref={ref}
      tabIndex={tabIndex}
      variant={tone}
      role={tone === "danger" ? "alert" : "status"}
      className="focus-visible:outline-2 focus-visible:outline-focus"
    >
      <Icon aria-hidden className="mt-1 size-4 shrink-0" strokeWidth={1.75} />
      <AlertDescription>{children}</AlertDescription>
    </BaseAlert>
  );
}
