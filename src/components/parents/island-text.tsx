import type { ReactNode } from "react";
import { Ltr } from "@/ui";

/**
 * Renders a translated sentence with one `{token}` replaced by an isolated value, so it never
 * reorders inside Arabic text. `kind="ltr"` (default) is for codes and emails; `kind="name"` is a
 * `<bdi>` for a person's name, which takes its own direction.
 */
export function IslandText({
  template,
  token,
  children,
  className,
  kind = "ltr",
  wrap = false,
}: {
  template: string;
  token: string;
  children: ReactNode;
  className?: string;
  kind?: "ltr" | "name";
  /** Let a long value (a masked email) wrap instead of forcing one line. */
  wrap?: boolean;
}) {
  const marker = `{${token}}`;
  const at = template.indexOf(marker);
  if (at < 0) return <>{template}</>;
  return (
    <>
      {template.slice(0, at)}
      {kind === "name" ? (
        <bdi className={className}>{children}</bdi>
      ) : (
        <Ltr className={className} wrap={wrap}>
          {children}
        </Ltr>
      )}
      {template.slice(at + marker.length)}
    </>
  );
}
