import { ForgotPasswordForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/auth-shell";
import { getDictionary } from "@/i18n/server";
import { currentCaptchaConfig } from "@/server/auth/captcha";

export default async function ForgotPasswordPage() {
  const { t, locale } = await getDictionary();
  return (
    <AuthShell title={t.auth.forgot.title} subtitle={t.auth.forgot.subtitle}>
      <ForgotPasswordForm t={t.auth} captcha={currentCaptchaConfig()} locale={locale} />
    </AuthShell>
  );
}
