import { LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeSwitch } from "@/components/al/theme-switch";
import { DemoBanner } from "@/components/demo-banner";
import { LanguageSwitch } from "@/components/language-switch";
import { SkipLink } from "@/components/skip-link";
import { getDictionary } from "@/i18n/server";
import { signOutAction } from "@/server/auth/actions";
import { requireUser } from "@/server/auth/session";
import { Button, Container, Wordmark } from "@/ui";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireUser();
  const { t } = await getDictionary();
  return (
    <>
      <SkipLink label={t.common.skipToContent} />
      <DemoBanner />
      <header className="border-b border-line bg-raised">
        <Container className="flex min-h-16 items-center gap-2 sm:gap-3">
          <Link href="/" className="shrink-0 rounded-[var(--radius-sm)]">
            <Wordmark label={t.common.brand} />
          </Link>
          <div className="ms-auto flex items-center gap-1">
            <LanguageSwitch />
            <ThemeSwitch />
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm">
                <LogOut aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />
                <span className="max-sm:sr-only">{t.common.signOut}</span>
              </Button>
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
