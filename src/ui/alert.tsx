import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ReactNode } from "react";
import { AlertDescription, Alert as BaseAlert } from "@/components/ui/alert";

type Tone = "info" | "success" | "danger";

const icons = { info: Info, success: CircleCheck, danger: CircleAlert };

export function Alert({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  const Icon = icons[tone];
  return (
    <BaseAlert variant={tone} role={tone === "danger" ? "alert" : "status"}>
      <Icon aria-hidden className="mt-1 size-4 shrink-0" strokeWidth={1.75} />
      <AlertDescription>{children}</AlertDescription>
    </BaseAlert>
  );
}
