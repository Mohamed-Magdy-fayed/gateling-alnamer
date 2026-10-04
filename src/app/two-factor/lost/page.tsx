import Link from "next/link";
import { linkClass } from "@/components/auth-parts";
import { AuthShell } from "@/components/auth-shell";
import { getDictionary } from "@/i18n/server";
import { requireUnverifiedStaff } from "../guard";

export default async function TwoFactorLostPage() {
  await requireUnverifiedStaff(undefined);
  const { t } = await getDictionary();
  return (
    <AuthShell title={t.twoFactor.lostTitle} subtitle={t.twoFactor.lostBody}>
      <Link href="/two-factor" className={linkClass}>
        {t.twoFactor.back}
      </Link>
    </AuthShell>
  );
}
