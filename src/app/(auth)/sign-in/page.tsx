import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/auth-shell";
import { getDictionary } from "@/i18n/server";
import { getCurrentUser } from "@/server/auth/session";

export default async function SignInPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  const { t } = await getDictionary();
  return (
    <AuthShell title={t.auth.signIn.title} subtitle={t.auth.signIn.subtitle}>
      <SignInForm t={t.auth} />
    </AuthShell>
  );
}
