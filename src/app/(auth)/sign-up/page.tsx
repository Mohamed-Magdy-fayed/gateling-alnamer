import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/auth-shell";
import { getDictionary } from "@/i18n/server";
import { currentCaptchaConfig } from "@/server/auth/captcha";
import { getCurrentUser } from "@/server/auth/session";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { t, locale } = await getDictionary();
  const { role } = await searchParams;
  return (
    <AuthShell title={t.auth.signUp.title} subtitle={t.auth.signUp.subtitle}>
      <SignUpForm
        t={t.auth}
        defaultRole={role ?? "student"}
        locale={locale}
        captcha={currentCaptchaConfig()}
        deviceNotice={t.devices.privateNotice}
      />
    </AuthShell>
  );
}
