import { AuthShell } from "@/components/auth-shell";
import { TeacherApplyForm } from "@/components/teach/apply-form";
import { getDictionary } from "@/i18n/server";
import { signOutAction } from "@/server/auth/actions";
import { currentCaptchaConfig } from "@/server/auth/captcha";
import { getCurrentUser } from "@/server/auth/session";
import { Alert, Button } from "@/ui";

export async function generateMetadata() {
  const { t } = await getDictionary();
  return { title: t.teachers.apply.title };
}

/** Apply to teach (C1). A signed-in visitor is asked to sign out: teacher accounts are separate. */
export default async function TeacherApplyPage() {
  const { t, locale } = await getDictionary();
  const user = await getCurrentUser();
  return (
    <AuthShell title={t.teachers.apply.title} subtitle={t.teachers.apply.subtitle}>
      {user ? (
        <div className="flex flex-col gap-4">
          <Alert tone="info">{t.teachers.apply.signedIn}</Alert>
          <form action={signOutAction}>
            <Button type="submit" variant="outline" size="lg" className="w-full">
              {t.common.signOut}
            </Button>
          </form>
        </div>
      ) : (
        <TeacherApplyForm
          t={t.teachers}
          auth={t.auth}
          captcha={currentCaptchaConfig()}
          locale={locale}
        />
      )}
    </AuthShell>
  );
}
