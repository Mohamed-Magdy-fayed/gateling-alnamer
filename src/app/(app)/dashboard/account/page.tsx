import { SignOutOthersForm } from "@/components/devices/sign-out-others-form";
import { getDictionary } from "@/i18n/server";
import { requirePageUser } from "@/server/auth/page-guard";
import { Container } from "@/ui";

/** Minimal account page: one action for now (A7a's shell will host more). */
export default async function AccountPage() {
  await requirePageUser("/dashboard/account");
  const { t } = await getDictionary();
  return (
    <Container className="flex flex-col gap-6 py-8">
      <h1 className="text-2xl font-bold">{t.devices.accountTitle}</h1>
      <p className="max-w-md text-sm text-fg-muted">{t.devices.accountHint}</p>
      <SignOutOthersForm label={t.devices.signOutOthers} authT={t.auth} />
    </Container>
  );
}
