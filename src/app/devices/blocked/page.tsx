import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { BlockedPanel } from "@/components/devices/blocked-panel";
import { format, formatDate, plural } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { clock } from "@/server/clock";
import { getPreSession } from "@/server/devices/pre-session";
import { listActiveDevices, nextSelfRemovalAt } from "@/server/devices/service";
import { getPlatformSettings } from "@/server/settings/repository";

const THROTTLE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  const confirmDate = formatDate(locale, new Date(clock.now().getTime() + THROTTLE_DAYS * DAY_MS));
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
        confirmText={format(t.devices.removeConfirm, { date: confirmDate })}
      />
    </AuthShell>
  );
}
