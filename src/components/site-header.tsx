import Link from "next/link";
import { getDictionary } from "@/i18n/server";
import { getCurrentUser } from "@/server/auth/session";
import { ButtonLink, Container, Wordmark } from "@/ui";
import { ThemeSwitch } from "./al/theme-switch";
import { LanguageSwitch } from "./language-switch";
import { MobileMenu } from "./mobile-menu";
import { SkipLink } from "./skip-link";

export async function SiteHeader() {
  const { t } = await getDictionary();
  const user = await getCurrentUser().catch(() => null);
  const links = [
    { href: "/#how-it-works", label: t.nav.howItWorks },
    { href: "/courses", label: t.nav.courses },
    { href: "/#teachers", label: t.nav.teachers },
    { href: "/#faq", label: t.nav.faq },
  ];
  // Below sm the sign-in link and the primary call to action live in the menu so the header
  // cluster (language, theme, menu) fits at 320px.
  const menuLinks = user ? links : [...links, { href: "/sign-in", label: t.common.signIn }];
  const cta = user
    ? { href: "/dashboard", label: t.common.dashboard }
    : { href: "/sign-up", label: t.common.signUp };

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
      <SkipLink label={t.common.skipToContent} />
      <Container size="marketing" className="flex min-h-16 items-center gap-2 sm:gap-4">
        <Link href="/" className="shrink-0 rounded-[var(--radius-sm)]">
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
        <div className="ms-auto flex items-center gap-1 sm:gap-2">
          <LanguageSwitch />
          <ThemeSwitch />
          {user ? (
            <ButtonLink href="/dashboard" size="sm" className="max-sm:hidden">
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
              <ButtonLink href="/sign-up" size="sm" className="max-sm:hidden">
                {t.common.signUp}
              </ButtonLink>
            </>
          )}
          <MobileMenu
            links={menuLinks}
            cta={cta}
            labels={{
              open: t.common.openMenu,
              close: t.common.closeMenu,
              title: t.common.menu,
              nav: t.common.mainNav,
            }}
          />
        </div>
      </Container>
    </header>
  );
}
