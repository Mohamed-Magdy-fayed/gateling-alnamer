import { ForgotPasswordForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/auth-shell";
import { getDictionary } from "@/i18n/server";

export default async function ForgotPasswordPage() {
  const { t } = await getDictionary();
  return (
    <AuthShell title={t.auth.forgot.title} subtitle={t.auth.forgot.subtitle}>
      <ForgotPasswordForm t={t.auth} />
    </AuthShell>
  );
}
