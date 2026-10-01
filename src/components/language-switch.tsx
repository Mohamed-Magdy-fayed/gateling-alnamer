import { Languages } from "lucide-react";
import { setLocaleAction } from "@/i18n/actions";
import type { Locale } from "@/i18n/config";
import { buttonClasses } from "@/ui";

export function LanguageSwitch({ locale, label }: { locale: Locale; label: string }) {
  const next: Locale = locale === "ar" ? "en" : "ar";
  return (
    <form action={setLocaleAction}>
      <input type="hidden" name="locale" value={next} />
      <button type="submit" lang={next} className={buttonClasses("ghost", "sm")}>
        <Languages aria-hidden className="size-4" strokeWidth={1.75} />
        {label}
      </button>
    </form>
  );
}
