import { Languages } from "lucide-react";
import { setLocaleAction } from "@/i18n/actions";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { buttonClasses } from "@/ui";

/** Below `sm` only the short label shows; the full label stays as the accessible name. */
export async function LanguageSwitch() {
  const { t, locale } = await getDictionary();
  const next: Locale = locale === "ar" ? "en" : "ar";
  return (
    <form action={setLocaleAction}>
      <input type="hidden" name="locale" value={next} />
      <button type="submit" lang={next} className={buttonClasses("ghost", "sm")}>
        <Languages aria-hidden className="size-4" strokeWidth={1.75} />
        <span aria-hidden className="sm:hidden">
          {t.common.switchLanguageShort}
        </span>
        <span className="max-sm:sr-only">{t.common.switchLanguage}</span>
      </button>
    </form>
  );
}
