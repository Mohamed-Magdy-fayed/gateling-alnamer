import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Button content that swaps a spinner in without changing the button's width: the label stays in
 * flow (hidden while pending) and the spinner sits over it. The spin stops under reduced motion.
 */
export function LoadingSwap({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <span className="relative inline-flex items-center justify-center gap-2">
      <span className={cn("inline-flex items-center gap-2", pending && "invisible")}>
        {children}
      </span>
      {pending ? (
        <LoaderCircle
          aria-hidden
          className="absolute size-4 animate-spin motion-reduce:animate-none"
        />
      ) : null}
    </span>
  );
}
