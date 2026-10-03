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
import type { SessionUser } from "@/server/auth/session";
import { isEmailVerified } from "@/server/auth/verified-email";
import { Button, ButtonLink, Wordmark } from "@/ui";
import { MobileNav } from "./mobile-nav";
import { NAV } from "./nav";
import { ShellNav } from "./shell-nav";

/** Resolves a dotted dictionary path (`common.dashboard`); a missing path shows the key, never a blank. */
function navLabel(dictionary: object, keyPath: string): string {
  const value = keyPath
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        typeof node === "object" && node !== null ? Reflect.get(node, key) : undefined,
      dictionary,
    );
  return typeof value === "string" ? value : keyPath;
}

/**
 * The signed-in frame (DESIGN section 4): a header with the wordmark, language and theme
 * switches, the account link and sign-out, a 16rem sidebar on the inline-start side from 1024px
 * (a Sheet below), and `main` with the email-verification notice. The nav lists only the live
 * routes of the user's role (`nav.ts`).
 */
export async function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const { t } = await getDictionary();
  const showVerifyBanner = Boolean(user.email) && !(await isEmailVerified(user.id));
  const items = NAV[user.role].map((item) => ({
    href: item.href,
    icon: item.icon,
    label: navLabel(t, item.labelKey),
  }));
  return (
    <>
      <SkipLink label={t.common.skipToContent} />
      <DemoBanner />
      <header className="border-b border-line bg-raised">
        <div className="flex min-h-16 items-center gap-1 px-4 sm:gap-3 sm:px-6 lg:px-8">
          <MobileNav
            items={items}
            labels={{
              open: t.shell.openMenu,
              close: t.shell.closeMenu,
              title: t.common.menu,
              nav: t.common.mainNav,
            }}
          />
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-sm)]"
          >
            <Wordmark label={t.common.brand} labelClassName="max-sm:sr-only" />
          </Link>
          <div className="ms-auto flex items-center gap-1">
            <LanguageSwitch />
            <ThemeSwitch />
            <ButtonLink
              href="/dashboard/account"
              variant="ghost"
              size="sm"
              className="min-h-11 min-w-11 max-sm:hidden lg:hidden"
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
        </div>
      </header>
      <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="hidden border-e border-line bg-raised lg:block">
          <div className="sticky top-0 p-4">
            <ShellNav items={items} label={t.common.mainNav} />
          </div>
        </aside>
        <main id="main" tabIndex={-1} className="min-w-0 pb-16 focus:outline-none">
          {showVerifyBanner && user.email ? <VerifyBanner t={t} email={user.email} /> : null}
          {children}
        </main>
      </div>
    </>
  );
}
