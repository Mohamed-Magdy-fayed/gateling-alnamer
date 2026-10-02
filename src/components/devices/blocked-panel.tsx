"use client";

import { LoaderCircle, Monitor } from "lucide-react";
import { useActionState, useState } from "react";
import { contactSupportAction, removeDeviceAction } from "@/app/devices/blocked/actions";
import { type AuthText, idle, Message } from "@/components/auth-parts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Dictionary } from "@/i18n/ar";
import { format, formatDate, type Locale } from "@/i18n/config";
import { SELF_REMOVAL_INTERVAL_MS } from "@/server/devices/policy";
import { Alert, Button, Ltr } from "@/ui";
import { SubmitButton } from "@/ui/submit-button";

type DeviceText = Dictionary["devices"];
export type BlockedDevice = { id: string; label: string | null; lastSeen: string };

type Props = {
  t: DeviceText;
  authT: AuthText;
  devices: BlockedDevice[];
  /** "You can remove another device after <date>" when a removal happened within the week, else null. */
  throttledText: string | null;
  locale: Locale;
};

type RowProps = {
  device: BlockedDevice;
  t: DeviceText;
  throttled: boolean;
  pending: boolean;
  locale: Locale;
};

const THROTTLE_ID = "device-throttle";

/** Rendered only while the dialog is open, so its date is today's, never the page-load day's. */
function ConfirmText({ t, locale }: { t: DeviceText; locale: Locale }) {
  const date = formatDate(locale, new Date(Date.now() + SELF_REMOVAL_INTERVAL_MS));
  return <>{format(t.removeConfirm, { date })}</>;
}

function DeviceRow({ device, t, throttled, pending, locale }: RowProps) {
  const labelId = `device-label-${device.id}`;
  const name = device.label ? <Ltr wrap>{device.label}</Ltr> : t.unknownDevice;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Monitor aria-hidden className="size-5 shrink-0 text-fg-muted" strokeWidth={1.75} />
        <div className="min-w-0">
          <p id={labelId} className="font-medium break-words">
            {name}
          </p>
          <p className="text-sm text-fg-muted">{format(t.lastSeen, { time: device.lastSeen })}</p>
        </div>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11"
            disabled={throttled || pending}
            aria-busy={pending}
            aria-describedby={throttled ? `${labelId} ${THROTTLE_ID}` : labelId}
          >
            {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
            {t.remove}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.remove}</AlertDialogTitle>
            <AlertDialogDescription>
              <ConfirmText t={t} locale={locale} />
              <span className="mt-2 block break-words">
                {t.removeDialogDevice} {name}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              type="submit"
              form={`remove-${device.id}`}
              variant="destructive"
              className="min-h-11"
            >
              {t.remove}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

export function BlockedPanel({ t, authT, devices, throttledText, locale }: Props) {
  const [removeState, removeAction, removing] = useActionState(removeDeviceAction, idle);
  const [supportState, supportAction] = useActionState(contactSupportAction, idle);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const throttled = throttledText !== null || removeState.tone === "warning";
  const submitRemoval = (payload: FormData) => {
    setPendingId(String(payload.get("deviceId") ?? ""));
    removeAction(payload);
  };
  return (
    <div className="flex flex-col gap-4">
      <Message state={removeState} t={authT} />
      <ul className="divide-y divide-line">
        {devices.map((device) => (
          <DeviceRow
            key={device.id}
            device={device}
            t={t}
            throttled={throttled}
            pending={removing && pendingId === device.id}
            locale={locale}
          />
        ))}
      </ul>
      {devices.map((device) => (
        <form key={device.id} id={`remove-${device.id}`} action={submitRemoval} hidden>
          <input type="hidden" name="deviceId" value={device.id} />
        </form>
      ))}
      {throttledText ? (
        <Alert tone="warning" id={THROTTLE_ID}>
          {throttledText}
        </Alert>
      ) : null}
      <Alert tone="info">{t.privateNotice}</Alert>
      <form action={supportAction} className="flex flex-col gap-4">
        <Message state={supportState} t={authT} />
        <SubmitButton variant="secondary">{t.contactSupport}</SubmitButton>
      </form>
    </div>
  );
}
