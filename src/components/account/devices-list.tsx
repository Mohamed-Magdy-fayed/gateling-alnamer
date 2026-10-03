"use client";

import { useMutation } from "@tanstack/react-query";
import { LoaderCircle, Monitor } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type AuthText, idle, Message } from "@/components/auth-parts";
import { ConfirmText } from "@/components/devices/blocked-panel";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Dictionary } from "@/i18n/ar";
import { format, type Locale } from "@/i18n/config";
import { useTRPC } from "@/lib/trpc/client";
import type { FormState } from "@/server/auth/actions";
import { Alert, Badge, Button, Ltr } from "@/ui";
import { accountErrorState } from "./error-state";

export type DeviceRowData = {
  id: string;
  label: string | null;
  /** Preformatted Cairo date and time, Latin digits. */
  lastSeenText: string;
  current: boolean;
};

type AccountText = Dictionary["account"];

type Texts = {
  t: AccountText;
  deviceT: Dictionary["devices"];
  authT: AuthText;
  locale: Locale;
};

type RowProps = Texts & {
  device: DeviceRowData;
  /** The weekly removal limit is in force: removal stays disabled and the reason is on screen. */
  throttled: boolean;
  onDone: (state: FormState) => void;
};

const THROTTLE_ID = "account-device-throttle";

function DeviceRow({ device, t, deviceT, authT, locale, throttled, onDone }: RowProps) {
  const router = useRouter();
  const trpc = useTRPC();
  const mutation = useMutation(trpc.account.removeDevice.mutationOptions());
  const [open, setOpen] = useState(false);
  const labelId = `account-device-${device.id}`;
  const name = device.label ? <Ltr wrap>{device.label}</Ltr> : deviceT.unknownDevice;

  function remove() {
    mutation.mutate(
      { deviceId: device.id },
      {
        onSuccess: () => {
          onDone({ status: "success", message: t.deviceRemoved });
          router.refresh();
        },
        onError: (error) => onDone(accountErrorState(error, authT)),
        onSettled: () => setOpen(false),
      },
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <Monitor aria-hidden className="mt-0.5 size-5 shrink-0 text-fg-muted" strokeWidth={1.75} />
        <div className="min-w-0">
          <p id={labelId} className="flex flex-wrap items-center gap-2 font-medium break-words">
            {name}
            {device.current ? <Badge tone="primary">{t.thisDevice}</Badge> : null}
          </p>
          <p className="text-sm text-fg-muted">
            {format(deviceT.lastSeen, { time: device.lastSeenText })}
          </p>
        </div>
      </div>
      {device.current ? null : (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              disabled={throttled || mutation.isPending}
              aria-busy={mutation.isPending}
              aria-describedby={throttled ? `${labelId} ${THROTTLE_ID}` : labelId}
            >
              {mutation.isPending ? (
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
              ) : null}
              {deviceT.remove}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{deviceT.remove}</AlertDialogTitle>
              <AlertDialogDescription>
                <ConfirmText t={deviceT} locale={locale} />
                <span className="mt-2 block break-words">
                  {deviceT.removeDialogDevice} {name}
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="min-h-11">{deviceT.cancel}</AlertDialogCancel>
              <Button
                type="button"
                variant="danger"
                className="min-h-11"
                disabled={mutation.isPending}
                onClick={remove}
              >
                {deviceT.remove}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </li>
  );
}

/** A student's registered devices. The current one cannot be removed; others follow the weekly limit. */
export function DevicesList({
  devices,
  throttledText,
  ...texts
}: Texts & { devices: DeviceRowData[]; throttledText: string | null }) {
  const [state, setState] = useState<FormState>(idle);
  const { t } = texts;
  if (devices.length === 0) return <p className="text-sm text-fg-2">{t.devicesEmpty}</p>;
  const throttled = throttledText !== null || state.tone === "warning";
  return (
    <div className="flex flex-col gap-3">
      <Message state={state} t={texts.authT} />
      <ul className="divide-y divide-line">
        {devices.map((device) => (
          <DeviceRow
            key={device.id}
            device={device}
            throttled={throttled}
            onDone={setState}
            {...texts}
          />
        ))}
      </ul>
      {throttledText ? (
        <Alert tone="warning" id={THROTTLE_ID}>
          {throttledText}
        </Alert>
      ) : null}
    </div>
  );
}
