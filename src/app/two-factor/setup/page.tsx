import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { AuthShell } from "@/components/auth-shell";
import { SetupForm } from "@/components/two-factor/setup-form";
import { getDictionary } from "@/i18n/server";
import { signOutAction } from "@/server/auth/actions";
import { pendingTotpSetup } from "@/server/auth/two-factor";
import { requireUnverifiedStaff } from "../guard";

export default async function TwoFactorSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: rawNext } = await searchParams;
  const { session, next } = await requireUnverifiedStaff(rawNext);
  const account = session.user.email ?? session.user.id;
  const setup = await pendingTotpSetup(session.user.id, session.tokenHash, account);
  if (!setup.ok) redirect(`/two-factor?next=${encodeURIComponent(next)}`);
  const { t } = await getDictionary();
  const qrSvg = await QRCode.toString(setup.uri, { type: "svg", margin: 1, width: 176 });
  const secretGroups = setup.secret.match(/.{1,4}/g)?.join(" ") ?? setup.secret;
  return (
    <AuthShell title={t.twoFactor.setupTitle} subtitle={t.twoFactor.setupIntro}>
      <SetupForm t={t.twoFactor} qrSvg={qrSvg} secretGroups={secretGroups} next={next} />
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
