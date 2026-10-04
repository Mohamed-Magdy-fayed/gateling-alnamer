import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/auth-shell";
import { GoogleButton } from "@/components/google/google-button";
import { getDictionary } from "@/i18n/server";
import { currentCaptchaConfig } from "@/server/auth/captcha";
import { currentProvider } from "@/server/auth/oauth/routes";
import { getCurrentUser } from "@/server/auth/session";
import { safeNextPath } from "@/server/devices/next-path";
import { Alert } from "@/ui";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; notice?: string }>;
}) {
  const { next, notice } = await searchParams;
  const target = safeNextPath(next);
  if (await getCurrentUser()) redirect(target);
  const { t, locale } = await getDictionary();
  return (
    <AuthShell title={t.auth.signIn.title} subtitle={t.auth.signIn.subtitle}>
      {notice === "google-failed" || notice === "google-password" ? (
        <div className="mb-4">
          <Alert tone={notice === "google-password" ? "info" : "danger"}>
            {notice === "google-password" ? t.google.needsPassword : t.google.failed}
          </Alert>
        </div>
      ) : null}
      {currentProvider() ? (
        <div className="mb-4">
          <GoogleButton label={t.google.continue} orLabel={t.google.or} next={target} />
        </div>
      ) : null}
      <SignInForm t={t.auth} captcha={currentCaptchaConfig()} locale={locale} next={target} />
    </AuthShell>
  );
}
