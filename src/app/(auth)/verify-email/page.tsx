import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { EmailVerified, VerifyEmailForm } from "@/components/verify-email-form";
import { getDictionary } from "@/i18n/server";
import { currentCaptchaConfig } from "@/server/auth/captcha";
import { requireUser } from "@/server/auth/session";
import { isEmailVerified } from "@/server/auth/verified-email";

export default async function VerifyEmailPage() {
  const user = await requireUser();
  // An account without an email has nothing to confirm.
  if (!user.email) redirect("/dashboard");
  const [{ t, locale }, verified] = await Promise.all([getDictionary(), isEmailVerified(user.id)]);
  return (
    <AuthShell title={t.auth.verify.title} subtitle={t.auth.verify.subtitle}>
      {verified ? (
        <EmailVerified t={t.auth} />
      ) : (
        <VerifyEmailForm t={t.auth} captcha={currentCaptchaConfig()} locale={locale} />
      )}
    </AuthShell>
  );
}
