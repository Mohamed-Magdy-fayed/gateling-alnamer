import { FlaskConical } from "lucide-react";
import { getDictionary } from "@/i18n/server";

export async function DemoBanner() {
  const { t } = await getDictionary();
  return (
    <p className="flex items-center justify-center gap-2 bg-highlight px-4 py-1.5 text-center text-xs font-medium text-highlight-fg">
      <FlaskConical aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
      {t.common.demoBanner}
    </p>
  );
}
