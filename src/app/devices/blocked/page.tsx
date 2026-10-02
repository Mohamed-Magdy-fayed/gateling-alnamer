import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { BlockedPanel } from "@/components/devices/blocked-panel";
import { format, formatDate, plural } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { getPreSession } from "@/server/devices/pre-session";
import { listActiveDevices, nextSelfRemovalAt } from "@/server/devices/service";
import { getPlatformSettings } from "@/server/settings/repository";

/** Device management for a student the limit blocked. Only the pre-session reaches it. */
export default async function DevicesBlockedPage() {
  const pre = await getPreSession();
  if (!pre) redirect("/sign-in");
  const { t, locale } = await getDictionary();
  const [list, nextAt, settings] = await Promise.all([
    listActiveDevices(pre.userId),
    nextSelfRemovalAt(pre.userId),
    getPlatformSettings(),
  ]);
  const devices = list.map((device) => ({
    id: device.id,
    label: device.label,
    lastSeen: formatDate(locale, device.lastSeenAt),
  }));
  return (
    <AuthShell
      title={t.devices.blockedTitle}
      subtitle={plural(locale, t.devices.blockedBody, settings.deviceLimit)}
    >
      <BlockedPanel
        t={t.devices}
        authT={t.auth}
        devices={devices}
        throttledText={
          nextAt ? format(t.devices.throttled, { date: formatDate(locale, nextAt) }) : null
        }
        locale={locale}
      />
    </AuthShell>
  );
}
