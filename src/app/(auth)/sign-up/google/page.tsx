import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { GoogleSignUpForm } from "@/components/google/google-sign-up-form";
import { getDictionary } from "@/i18n/server";
import { readPendingCookie } from "@/server/auth/oauth/cookies";
import { getCurrentUser } from "@/server/auth/session";
import { Ltr } from "@/ui";

/** A new Google user finishes here: role, date of birth and consent, then the account is created. */
export default async function GoogleSignUpPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  const pending = await readPendingCookie();
  if (!pending) redirect("/sign-in?notice=google-failed");
  const { t, locale } = await getDictionary();
  return (
    <AuthShell title={t.google.completeTitle} subtitle={t.google.completeIntro}>
      <p className="-mt-4 mb-6 font-medium">
        <Ltr>{pending.identity.email}</Ltr>
      </p>
      <GoogleSignUpForm
        t={t.auth}
        createLabel={t.google.create}
        locale={locale}
        defaultName={pending.identity.name}
        deviceNotice={t.devices.privateNotice}
      />
    </AuthShell>
  );
}
