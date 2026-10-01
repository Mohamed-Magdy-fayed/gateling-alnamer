import Link from "next/link";
import type { ReactNode } from "react";
import { getDictionary } from "@/i18n/server";
import { Card, GeometricPattern, Wordmark } from "@/ui";
import { DemoBanner } from "./demo-banner";
import { LanguageSwitch } from "./language-switch";

export async function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const { t, locale } = await getDictionary();
  return (
    <>
      <DemoBanner />
      <div className="relative flex min-h-[calc(100dvh-2rem)] flex-col overflow-hidden">
        <GeometricPattern className="text-primary opacity-[0.06]" />
        <header className="relative flex items-center justify-between px-4 py-4 sm:px-8">
          <Link href="/" className="rounded-[var(--radius-sm)]">
            <Wordmark label={t.common.brand} />
          </Link>
          <LanguageSwitch locale={locale} label={t.common.switchLanguage} />
        </header>
        <main id="main" className="relative flex flex-1 items-center justify-center px-4 py-10">
          <Card className="w-full max-w-md p-6 shadow-e3 sm:p-8">
            <h1 className="text-2xl font-bold">{title}</h1>
            <p className="mt-1 mb-6 text-fg-2">{subtitle}</p>
            {children}
          </Card>
        </main>
      </div>
    </>
  );
}
