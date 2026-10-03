import type { ReactNode } from "react";
import { Ltr } from "@/ui";

/**
 * Renders a translated sentence with one `{token}` replaced by an LTR island (a code, a masked
 * email), so the value never reorders inside Arabic text.
 */
export function IslandText({
  template,
  token,
  children,
  className,
}: {
  template: string;
  token: string;
  children: ReactNode;
  className?: string;
}) {
  const marker = `{${token}}`;
  const at = template.indexOf(marker);
  if (at < 0) return <>{template}</>;
  return (
    <>
      {template.slice(0, at)}
      <Ltr className={className}>{children}</Ltr>
      {template.slice(at + marker.length)}
    </>
  );
}
