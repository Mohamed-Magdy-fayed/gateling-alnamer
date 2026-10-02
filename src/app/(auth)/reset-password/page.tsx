import { ResetPasswordForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/auth-shell";
import { getDictionary } from "@/i18n/server";
import { readPendingReset } from "@/server/auth/pending-reset";

export default async function ResetPasswordPage() {
  const { t } = await getDictionary();
  const pending = (await readPendingReset()) !== null;
  return (
    <AuthShell title={t.auth.reset.title} subtitle={t.auth.reset.subtitle}>
      <ResetPasswordForm t={t.auth} pending={pending} />
    </AuthShell>
  );
}
