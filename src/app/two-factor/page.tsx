import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { ChallengeForm } from "@/components/two-factor/challenge-form";
import { getDictionary } from "@/i18n/server";
import { signOutAction } from "@/server/auth/actions";
import { twoFactorStatus } from "@/server/auth/two-factor";
import { requireUnverifiedStaff } from "./guard";

export default async function TwoFactorChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: rawNext } = await searchParams;
  const { session, next } = await requireUnverifiedStaff(rawNext);
  const { enrolled } = await twoFactorStatus(session.user.id);
  if (!enrolled) redirect(`/two-factor/setup?next=${encodeURIComponent(next)}`);
  const { t } = await getDictionary();
  return (
    <AuthShell title={t.twoFactor.challengeTitle} subtitle={t.twoFactor.challengeIntro}>
      <ChallengeForm t={t.twoFactor} next={next} />
      <form action={signOutAction} className="mt-6">
        <button
          type="submit"
          className="min-h-11 text-sm text-fg-2 underline-offset-4 hover:underline"
        >
          {t.common.signOut}
        </button>
      </form>
    </AuthShell>
  );
}
