import { LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeSwitch } from "@/components/al/theme-switch";
import { DemoBanner } from "@/components/demo-banner";
import { LanguageSwitch } from "@/components/language-switch";
import { getDictionary } from "@/i18n/server";
import { signOutAction } from "@/server/auth/actions";
import { requireUser } from "@/server/auth/session";
import { buttonClasses, Container, Wordmark } from "@/ui";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireUser();
  const { t, locale } = await getDictionary();
  return (
    <>
      <DemoBanner />
      <header className="border-b border-line bg-raised">
        <Container className="flex min-h-16 items-center gap-3">
          <Link href="/" className="rounded-[var(--radius-sm)]">
            <Wordmark label={t.common.brand} />
          </Link>
          <div className="ms-auto flex items-center gap-1">
            <LanguageSwitch locale={locale} label={t.common.switchLanguage} />
            <ThemeSwitch />
            <form action={signOutAction}>
              <button type="submit" className={buttonClasses("ghost", "sm")}>
                <LogOut aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />
                <span className="max-sm:sr-only">{t.common.signOut}</span>
              </button>
            </form>
          </div>
        </Container>
      </header>
      <main id="main" className="pb-16">
        {children}
      </main>
    </>
  );
}
