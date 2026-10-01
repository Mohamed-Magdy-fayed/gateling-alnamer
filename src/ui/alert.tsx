import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "info" | "success" | "danger";

const tones: Record<Tone, string> = {
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
};
const icons = { info: Info, success: CircleCheck, danger: CircleAlert };

export function Alert({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  const Icon = icons[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-[var(--radius-sm)] px-3 py-2.5 text-sm",
        tones[tone],
      )}
    >
      <Icon aria-hidden className="mt-1 size-4 shrink-0" strokeWidth={1.75} />
      <div>{children}</div>
    </div>
  );
}
