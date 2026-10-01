import Link from "next/link";
import { getDictionary } from "@/i18n/server";
import { Container, Ltr, Wordmark } from "@/ui";

export async function SiteFooter() {
  const { t } = await getDictionary();
  const year = new Date().getFullYear();
  const linkClass = "text-fg-inverse/80 hover:text-fg-inverse underline-offset-4 hover:underline";
  return (
    <footer className="bg-inverse text-fg-inverse">
      <Container size="marketing" className="grid gap-10 py-14 md:grid-cols-[2fr_1fr_1fr]">
        <div className="flex max-w-sm flex-col gap-3">
          <Wordmark label={t.common.brand} className="text-fg-inverse" />
          <p className="text-sm text-fg-inverse/80">{t.home.footerAbout}</p>
        </div>
        <nav aria-label={t.home.footerLinks}>
          <h2 className="mb-3 text-sm font-semibold">{t.home.footerLinks}</h2>
          <ul className="flex flex-col gap-2 text-sm">
            <li>
              <Link href="/courses" className={linkClass}>
                {t.nav.courses}
              </Link>
            </li>
            <li>
              <Link href="/sign-up?role=teacher" className={linkClass}>
                {t.nav.teachers}
              </Link>
            </li>
            <li>
              <Link href="/#faq" className={linkClass}>
                {t.nav.faq}
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label={t.home.footerLegal}>
          <h2 className="mb-3 text-sm font-semibold">{t.home.footerLegal}</h2>
          <ul className="flex flex-col gap-2 text-sm">
            <li>
              <Link href="/legal/terms" className={linkClass}>
                {t.legal.terms}
              </Link>
            </li>
            <li>
              <Link href="/legal/privacy" className={linkClass}>
                {t.legal.privacy}
              </Link>
            </li>
            <li>
              <Link href="/legal/refunds" className={linkClass}>
                {t.legal.refunds}
              </Link>
            </li>
          </ul>
        </nav>
      </Container>
      <Container
        size="marketing"
        className="flex flex-wrap justify-between gap-2 border-t border-fg-inverse/15 py-5 text-xs text-fg-inverse/70"
      >
        <p>
          © <Ltr>{year}</Ltr> {t.common.brand}. {t.home.rights}
        </p>
        <p>{t.home.builtBy}</p>
      </Container>
    </footer>
  );
}
