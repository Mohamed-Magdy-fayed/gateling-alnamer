import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/auth-shell";
import { getDictionary } from "@/i18n/server";
import { getCurrentUser } from "@/server/auth/session";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { t } = await getDictionary();
  const { role } = await searchParams;
  return (
    <AuthShell title={t.auth.signUp.title} subtitle={t.auth.signUp.subtitle}>
      <SignUpForm t={t.auth} defaultRole={role ?? "student"} />
    </AuthShell>
  );
}
