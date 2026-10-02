import { Menu } from "lucide-react";
import Link from "next/link";
import { getDictionary } from "@/i18n/server";
import { getCurrentUser } from "@/server/auth/session";
import { ButtonLink, Container, Wordmark } from "@/ui";
import { ThemeSwitch } from "./al/theme-switch";
import { LanguageSwitch } from "./language-switch";

export async function SiteHeader() {
  const { t, locale } = await getDictionary();
  const user = await getCurrentUser().catch(() => null);
  const links = [
    { href: "/#how-it-works", label: t.nav.howItWorks },
    { href: "/courses", label: t.nav.courses },
    { href: "/#teachers", label: t.nav.teachers },
    { href: "/#faq", label: t.nav.faq },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-2 focus:rounded-[var(--radius-sm)] focus:bg-raised focus:px-3 focus:py-2"
      >
        {t.common.skipToContent}
      </a>
      <Container size="marketing" className="flex min-h-16 items-center gap-4">
        <Link href="/" className="rounded-[var(--radius-sm)]">
          <Wordmark label={t.common.brand} />
        </Link>
        <nav aria-label={t.common.mainNav} className="hidden flex-1 lg:block">
          <ul className="flex items-center gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="rounded-[var(--radius-sm)] px-3 py-2 text-sm text-fg-2 hover:bg-sunken hover:text-fg"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <LanguageSwitch locale={locale} label={t.common.switchLanguage} />
          <div className="hidden lg:block">
            <ThemeSwitch />
          </div>
          {user ? (
            <ButtonLink href="/dashboard" size="sm">
              {t.common.dashboard}
            </ButtonLink>
          ) : (
            <>
              <ButtonLink
                href="/sign-in"
                variant="ghost"
                size="sm"
                className="hidden sm:inline-flex"
              >
                {t.common.signIn}
              </ButtonLink>
              <ButtonLink href="/sign-up" size="sm">
                {t.common.signUp}
              </ButtonLink>
            </>
          )}
          <details className="relative lg:hidden">
            <summary
              aria-label={t.common.openMenu}
              className="flex size-11 cursor-pointer list-none items-center justify-center rounded-[var(--radius-md)] hover:bg-sunken [&::-webkit-details-marker]:hidden"
            >
              <Menu aria-hidden className="size-5" strokeWidth={1.75} />
            </summary>
            <nav
              aria-label={t.common.mainNav}
              className="absolute end-0 top-12 w-60 rounded-[var(--radius-md)] border border-line bg-raised p-2 shadow-e3"
            >
              <ul className="flex flex-col">
                {[...links, ...(user ? [] : [{ href: "/sign-in", label: t.common.signIn }])].map(
                  (link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="block rounded-[var(--radius-sm)] px-3 py-2.5 text-fg hover:bg-sunken"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ),
                )}
              </ul>
              <div className="mt-1 flex border-t border-line pt-2">
                <ThemeSwitch />
              </div>
            </nav>
          </details>
        </div>
      </Container>
    </header>
  );
}
