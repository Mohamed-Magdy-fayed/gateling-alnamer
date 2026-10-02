import { LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeSwitch } from "@/components/al/theme-switch";
import { DemoBanner } from "@/components/demo-banner";
import { LanguageSwitch } from "@/components/language-switch";
import { SkipLink } from "@/components/skip-link";
import { VerifyBanner } from "@/components/verify-banner";
import { getDictionary } from "@/i18n/server";
import { signOutAction } from "@/server/auth/actions";
import { requireUser } from "@/server/auth/session";
import { isEmailVerified } from "@/server/auth/verified-email";
import { Button, ButtonLink, Container, Wordmark } from "@/ui";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const { t } = await getDictionary();
  const showVerifyBanner = Boolean(user.email) && !(await isEmailVerified(user.id));
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
            <ButtonLink
              href="/dashboard/account"
              variant="ghost"
              size="sm"
              className="min-h-11 min-w-11 max-sm:hidden"
            >
              <UserRound aria-hidden className="size-4" strokeWidth={1.75} />
              <span>{t.devices.accountTitle}</span>
            </ButtonLink>
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm" className="min-h-11 min-w-11">
                <LogOut aria-hidden className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />
                <span className="max-sm:sr-only">{t.common.signOut}</span>
              </Button>
            </form>
          </div>
        </Container>
      </header>
      <nav aria-label={t.devices.accountTitle} className="sm:hidden">
        <Container className="pt-3">
          <ButtonLink
            href="/dashboard/account"
            variant="ghost"
            size="sm"
            className="min-h-11 min-w-11"
          >
            <UserRound aria-hidden className="size-4" strokeWidth={1.75} />
            {t.devices.accountTitle}
          </ButtonLink>
        </Container>
      </nav>
      <main id="main" className="pb-16">
        {showVerifyBanner && user.email ? <VerifyBanner t={t} email={user.email} /> : null}
        {children}
      </main>
    </>
  );
}
