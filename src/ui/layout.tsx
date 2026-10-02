import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export function Container({
  size = "app",
  className,
  ...props
}: ComponentProps<"div"> & { size?: "app" | "marketing" }) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-8",
        size === "marketing" ? "max-w-7xl" : "max-w-6xl",
        className,
      )}
      {...props}
    />
  );
}

/** LTR island for prices, codes, emails and numbers inside RTL text (DESIGN.md section 7). */
export function Ltr({
  children,
  className,
  wrap = false,
}: {
  children: ReactNode;
  className?: string;
  /** Let a long value (a device label) wrap instead of forcing one line. */
  wrap?: boolean;
}) {
  return (
    <bdi
      dir="ltr"
      className={cn(
        "tabular",
        wrap ? "whitespace-normal break-words" : "whitespace-nowrap",
        className,
      )}
    >
      {children}
    </bdi>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 w-full overflow-hidden rounded-full bg-sunken"
    >
      <div className="h-full rounded-full bg-primary" style={{ inlineSize: `${clamped}%` }} />
    </div>
  );
}
