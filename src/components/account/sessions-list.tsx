"use client";

import { useMutation } from "@tanstack/react-query";
import { LoaderCircle, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type AuthText, idle, Message } from "@/components/auth-parts";
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
import { format } from "@/i18n/config";
import { useTRPC } from "@/lib/trpc/client";
import type { FormState } from "@/server/auth/actions";
import { Badge, Button, Ltr } from "@/ui";
import { accountErrorState } from "./error-state";

export type SessionRowData = {
  id: string;
  /** Preformatted Cairo date and time, Latin digits. */
  createdText: string;
  lastSeenText: string | null;
  current: boolean;
  /** The student's device behind the session; null for everyone else. */
  deviceLabel: string | null;
};

type AccountText = Dictionary["account"];

type Texts = { t: AccountText; authT: AuthText; cancel: string };

type RowProps = Texts & {
  session: SessionRowData;
  onDone: (state: FormState) => void;
};

function SessionRow({ session, t, authT, cancel, onDone }: RowProps) {
  const router = useRouter();
  const trpc = useTRPC();
  const mutation = useMutation(trpc.account.revokeSession.mutationOptions());
  const [open, setOpen] = useState(false);
  const titleId = `session-${session.id}`;

  function revoke() {
    mutation.mutate(
      { id: session.id },
      {
        onSuccess: () => {
          onDone({ status: "success", message: t.revoked });
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
        <Smartphone
          aria-hidden
          className="mt-0.5 size-5 shrink-0 text-fg-muted"
          strokeWidth={1.75}
        />
        <div className="min-w-0">
          <p id={titleId} className="flex flex-wrap items-center gap-2 font-medium break-words">
            {format(t.sessionStarted, { time: session.createdText })}
            {session.current ? <Badge tone="primary">{t.thisSession}</Badge> : null}
          </p>
          {session.deviceLabel ? (
            <p className="text-sm text-fg-muted">
              <Ltr wrap>{session.deviceLabel}</Ltr>
            </p>
          ) : null}
          {session.lastSeenText ? (
            <p className="text-sm text-fg-muted">
              {format(t.sessionLastSeen, { time: session.lastSeenText })}
            </p>
          ) : null}
        </div>
      </div>
      {session.current ? null : (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              disabled={mutation.isPending}
              aria-busy={mutation.isPending}
              aria-describedby={titleId}
            >
              {mutation.isPending ? (
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
              ) : null}
              {t.revoke}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.revokeTitle}</AlertDialogTitle>
              <AlertDialogDescription>
                {format(t.revokeBody, { time: session.createdText })}
                {session.deviceLabel ? (
                  <span className="mt-2 block break-words">
                    <Ltr wrap>{session.deviceLabel}</Ltr>
                  </span>
                ) : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="min-h-11">{cancel}</AlertDialogCancel>
              <Button
                type="button"
                variant="danger"
                className="min-h-11"
                disabled={mutation.isPending}
                onClick={revoke}
              >
                {t.revoke}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </li>
  );
}

/** The live sessions, newest first. Ending one asks first, naming the session. */
export function SessionsList({
  sessions,
  t,
  authT,
  cancel,
}: Texts & { sessions: SessionRowData[] }) {
  const [state, setState] = useState<FormState>(idle);
  return (
    <div className="flex flex-col gap-3">
      <Message state={state} t={authT} />
      <ul className="divide-y divide-line">
        {sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            t={t}
            authT={authT}
            cancel={cancel}
            onDone={setState}
          />
        ))}
      </ul>
    </div>
  );
}
