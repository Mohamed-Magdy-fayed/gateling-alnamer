/** First focusable element on a page: jumps past the header to `#main`. */
export function SkipLink({ label }: { label: string }) {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-2 focus:z-50 focus:rounded-[var(--radius-sm)] focus:bg-raised focus:px-3 focus:py-2"
    >
      {label}
    </a>
  );
}
