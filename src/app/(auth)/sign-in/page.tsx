import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/auth-shell";
import { getDictionary } from "@/i18n/server";
import { currentCaptchaConfig } from "@/server/auth/captcha";
import { getCurrentUser } from "@/server/auth/session";
import { safeNextPath } from "@/server/devices/next-path";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = safeNextPath(next);
  if (await getCurrentUser()) redirect(target);
  const { t, locale } = await getDictionary();
  return (
    <AuthShell title={t.auth.signIn.title} subtitle={t.auth.signIn.subtitle}>
      <SignInForm t={t.auth} captcha={currentCaptchaConfig()} locale={locale} next={target} />
    </AuthShell>
  );
}
