import { eq } from "drizzle-orm";
import { type DeviceRowData, DevicesList } from "@/components/account/devices-list";
import { EmailSection } from "@/components/account/email-section";
import { PasswordForm } from "@/components/account/password-form";
import { ProfileForm } from "@/components/account/profile-form";
import { AccountSection } from "@/components/account/section";
import { type SessionRowData, SessionsList } from "@/components/account/sessions-list";
import { SignOutOthersForm } from "@/components/devices/sign-out-others-form";
import { AccountPasskeys } from "@/components/two-factor/account-passkeys";
import { AccountTwoFactor } from "@/components/two-factor/account-two-factor";
import { dirOf, format, formatDate, formatTime, isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { listSessions } from "@/server/account/service";
import { requirePageUser } from "@/server/auth/page-guard";
import { listPasskeys } from "@/server/auth/passkeys";
import { getCurrentSession } from "@/server/auth/session";
import { twoFactorStatus } from "@/server/auth/two-factor";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { listActiveDevices, nextSelfRemovalAt } from "@/server/devices/service";
import { Container } from "@/ui";

/** Cairo date and time with Latin digits, in one string (`account.dateTime`). */
function stamp(template: string, locale: Locale, at: Date): string {
  return format(template, { date: formatDate(locale, at), time: formatTime(locale, at) });
}

/** The student's devices with their weekly removal limit; the current device is the session's own. */
async function loadDevices(
  userId: string,
  currentDeviceId: string | null,
  template: string,
  locale: Locale,
): Promise<{ devices: DeviceRowData[]; nextAt: Date | null }> {
  const [list, nextAt] = await Promise.all([listActiveDevices(userId), nextSelfRemovalAt(userId)]);
  const devices = list.map((device) => ({
    id: device.id,
    label: device.label,
    lastSeenText: stamp(template, locale, device.lastSeenAt),
    current: device.id === currentDeviceId,
  }));
  return { devices, nextAt };
}

/** Profile, email, password, sessions and (students) devices: one Card per section. */
export default async function AccountPage() {
  const user = await requirePageUser("/dashboard/account");
  const session = await getCurrentSession();
  const { t, locale } = await getDictionary();
  const template = t.account.dateTime;

  const [row, sessions] = await Promise.all([
    db().query.users.findFirst({
      columns: { name: true, email: true, locale: true },
      where: eq(users.id, user.id),
    }),
    listSessions({
      userId: user.id,
      role: user.role,
      currentTokenHash: session?.tokenHash,
    }),
  ]);
  const saved = row?.locale;
  const preferred: Locale = saved && isLocale(saved) ? saved : locale;
  const sessionRows: SessionRowData[] = sessions.map((item) => ({
    id: item.id,
    createdText: stamp(template, locale, item.createdAt),
    lastSeenText: item.lastSeenAt ? stamp(template, locale, item.lastSeenAt) : null,
    current: item.current,
    deviceLabel: item.deviceLabel,
  }));

  const isStudent = user.role === "student";
  const isStaff = user.role === "teacher" || user.role === "admin" || user.role === "reviewer";
  const twoFactor = isStaff ? await twoFactorStatus(user.id) : null;
  const passkeyRows = isStaff ? await listPasskeys(user.id) : [];
  const deviceData = isStudent
    ? await loadDevices(user.id, session?.deviceId ?? null, template, locale)
    : null;

  return (
    <Container className="flex flex-col gap-6 py-8">
      <h1 className="text-2xl font-bold">{t.devices.accountTitle}</h1>

      <AccountSection id="profile" title={t.account.profileTitle}>
        <ProfileForm
          t={t.account}
          authT={t.auth}
          name={row?.name ?? user.name}
          locale={preferred}
          dir={dirOf(locale)}
        />
      </AccountSection>

      <AccountSection id="email" title={t.account.emailTitle}>
        <EmailSection t={t.account} authT={t.auth} email={row?.email ?? null} />
      </AccountSection>

      <AccountSection id="password" title={t.account.passwordTitle}>
        <PasswordForm t={t.account} authT={t.auth} />
      </AccountSection>

      <AccountSection id="sessions" title={t.account.sessionsTitle}>
        <SessionsList
          sessions={sessionRows}
          t={t.account}
          authT={t.auth}
          cancel={t.devices.cancel}
        />
        <p className="max-w-md text-sm text-fg-muted">{t.devices.accountHint}</p>
        <SignOutOthersForm label={t.devices.signOutOthers} authT={t.auth} />
      </AccountSection>

      {twoFactor?.enrolled ? (
        <AccountSection id="two-factor" title={t.twoFactor.accountTitle}>
          <AccountTwoFactor
            t={t.twoFactor}
            locale={locale}
            since={twoFactor.confirmedAt ? formatDate(locale, twoFactor.confirmedAt) : ""}
            recoveryLeft={twoFactor.recoveryLeft}
          />
          <AccountPasskeys
            t={t.twoFactor}
            items={passkeyRows.map((row) => ({
              id: row.id,
              addedText: formatDate(locale, row.createdAt),
            }))}
          />
        </AccountSection>
      ) : null}

      {deviceData ? (
        <AccountSection id="devices" title={t.account.devicesTitle}>
          <DevicesList
            devices={deviceData.devices}
            throttledText={
              deviceData.nextAt
                ? format(t.devices.throttled, { date: formatDate(locale, deviceData.nextAt) })
                : null
            }
            t={t.account}
            deviceT={t.devices}
            authT={t.auth}
            locale={locale}
          />
        </AccountSection>
      ) : null}
    </Container>
  );
}
