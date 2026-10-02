import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { VerifyEmailForm } from "@/components/verify-email-form";
import { getDictionary } from "@/i18n/server";
import { currentCaptchaConfig } from "@/server/auth/captcha";
import { requireUser } from "@/server/auth/session";
import { isEmailVerified } from "@/server/auth/verified-email";

export default async function VerifyEmailPage() {
  const user = await requireUser();
  // An account without an email has nothing to confirm.
  if (!user.email) redirect("/dashboard");
  const [{ t, locale }, verified] = await Promise.all([getDictionary(), isEmailVerified(user.id)]);
  const { verify } = t.auth;
  return (
    <AuthShell
      title={verified ? verify.doneTitle : verify.title}
      subtitle={verified ? verify.doneSubtitle : verify.subtitle}
    >
      <VerifyEmailForm
        t={t.auth}
        captcha={currentCaptchaConfig()}
        locale={locale}
        verified={verified}
      />
    </AuthShell>
  );
}
