import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Readex_Pro } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { dirOf } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { NO_FLASH_SCRIPT } from "@/lib/theme";
import { getTheme } from "@/lib/theme-server";
import { TrpcProvider } from "@/lib/trpc/client";
import "@/styles/globals.css";

const readex = Readex_Pro({
  subsets: ["arabic", "latin"],
  weight: ["500", "600", "700"],
  variable: "--font-readex",
  display: "swap",
});
const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDictionary();
  return { title: t.meta.title, description: t.meta.description };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf8f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1a1e" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, theme, requestHeaders] = await Promise.all([getLocale(), getTheme(), headers()]);
  // The proxy's CSP nonce (F5b): the one inline script must carry it.
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  return (
    <html
      lang={locale}
      dir={dirOf(locale)}
      data-theme={theme === "system" ? undefined : theme}
      className={`${readex.variable} ${plex.variable}`}
      suppressHydrationWarning
    >
      {theme === "system" && (
        <head>
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant string, no user input; carries the CSP nonce */}
          <script nonce={nonce} dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
        </head>
      )}
      <body>
        <TrpcProvider>{children}</TrpcProvider>
      </body>
    </html>
  );
}
