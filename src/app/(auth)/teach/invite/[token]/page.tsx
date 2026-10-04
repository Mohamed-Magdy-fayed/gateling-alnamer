import Link from "next/link";
import { linkClass } from "@/components/auth-parts";
import { AuthShell } from "@/components/auth-shell";
import { InviteRedeemForm } from "@/components/teach/invite-redeem-form";
import { getDictionary } from "@/i18n/server";
import { signOutAction } from "@/server/auth/actions";
import { getCurrentUser } from "@/server/auth/session";
import { peekTeacherInvite } from "@/server/catalog/teachers/invites";
import { Alert, Button } from "@/ui";

export async function generateMetadata() {
  const { t } = await getDictionary();
  return { title: t.teachers.invite.title, referrer: "no-referrer" as const };
}

/**
 * Accept a teacher invitation (C1). The token stays in the URL only; a bad, used or expired one
 * shows one message. A signed-in visitor is asked to sign out first (accounts are separate).
 */
export default async function TeacherInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [{ t, locale }, user, invite] = await Promise.all([
    getDictionary(),
    getCurrentUser(),
    peekTeacherInvite(token),
  ]);
  const i = t.teachers.invite;
  return (
    <AuthShell title={i.title} subtitle={i.subtitle}>
      {!invite ? (
        <div className="flex flex-col gap-4">
          <Alert tone="warning">{i.invalid}</Alert>
          <Link href="/sign-in" className={linkClass}>
            {t.teachers.apply.signIn}
          </Link>
        </div>
      ) : user ? (
        <div className="flex flex-col gap-4">
          <Alert tone="info">{i.signedIn}</Alert>
          <form action={signOutAction}>
            <Button type="submit" variant="outline" size="lg" className="w-full">
              {t.common.signOut}
            </Button>
          </form>
        </div>
      ) : (
        <InviteRedeemForm
          t={t.teachers}
          auth={t.auth}
          locale={locale}
          token={token}
          name={invite.name}
          email={invite.email}
        />
      )}
    </AuthShell>
  );
}
