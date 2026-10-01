import { cn } from "./cn";

/** Text wordmark until the client supplies a logo. */
export function Wordmark({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-[family-name:var(--font-display)] text-xl font-bold text-fg",
        className,
      )}
    >
      <svg viewBox="0 0 32 32" aria-hidden className="size-7 text-primary" fill="none">
        <path
          d="M16 2l3.8 5.2L26 6l-1.2 6.2L30 16l-5.2 3.8L26 26l-6.2-1.2L16 30l-3.8-5.2L6 26l1.2-6.2L2 16l5.2-3.8L6 6l6.2 1.2L16 2z"
          fill="currentColor"
        />
        <circle cx="16" cy="16" r="4.5" fill="var(--accent)" />
      </svg>
      {label}
    </span>
  );
}

/** 8-point star lattice texture. Decorative only; never behind body text. */
export function GeometricPattern({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={cn("pointer-events-none absolute inset-0 size-full", className)}>
      <defs>
        <pattern id="alnamer-lattice" width="56" height="56" patternUnits="userSpaceOnUse">
          <path
            d="M28 6l6 8 10-2-2 10 8 6-8 6 2 10-10-2-6 8-6-8-10 2 2-10-8-6 8-6-2-10 10 2z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#alnamer-lattice)" />
    </svg>
  );
}
