"use client";

import { useMutation } from "@tanstack/react-query";
import { LoaderCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { idle, Message } from "@/components/auth-parts";
import { format, formatDate, type Locale } from "@/i18n/config";
import { useTRPC } from "@/lib/trpc/client";
import type { FormState } from "@/server/auth/actions";
import type { ParentDashboardData } from "@/server/parents/dashboard";
import { Alert, Button, Card } from "@/ui";
import { ChildCard } from "./child-card";
import { CreateChildSheet } from "./create-child-sheet";
import { errorState, type ParentTexts } from "./error-state";
import { InvitePanel } from "./invite-panel";

type Props = {
  data: ParentDashboardData;
  t: ParentTexts;
  locale: Locale;
};

/** The parent dashboard: one card per child, the two ways to add one, and the live link codes. */
export function ParentCards({ data, t, locale }: Props) {
  const router = useRouter();
  const trpc = useTRPC();
  const invite = useMutation(trpc.parent.invites.create.mutationOptions());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [created, setCreated] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [inviteState, setInviteState] = useState<FormState>(idle);
  const parents = t.parents;

  function issueCode() {
    invite.mutate(undefined, {
      onSuccess: (result) => {
        setInviteState(idle);
        setCode(result.code);
        router.refresh();
      },
      onError: (error) => setInviteState(errorState(error, t)),
    });
  }

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() => {
          setCreated(false);
          setSheetOpen(true);
        }}
      >
        <Plus aria-hidden className="size-4" strokeWidth={1.75} />
        {parents.addChild}
      </Button>
      <Button
        variant="outline"
        disabled={invite.isPending}
        aria-busy={invite.isPending}
        onClick={issueCode}
      >
        {invite.isPending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
        {parents.inviteCreate}
      </Button>
    </div>
  );

  return (
    <section aria-labelledby="children" className="flex flex-col gap-4">
      <h2 id="children" className="text-lg font-semibold">
        {parents.cardsTitle}
      </h2>
      {created ? <Alert tone="success">{parents.childCreated}</Alert> : null}
      <Message state={inviteState} t={t.auth} />
      {code ? <InvitePanel code={code} t={t} /> : null}
      {data.children.length === 0 ? (
        <Card className="flex flex-col items-start gap-4 p-6">
          <p className="text-fg-2">{parents.empty}</p>
          {actions}
        </Card>
      ) : (
        <>
          {actions}
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {data.children.map((child) => (
              <li key={child.childId}>
                <ChildCard child={child} t={t} locale={locale} onChanged={() => router.refresh()} />
              </li>
            ))}
          </ul>
        </>
      )}
      {data.invites.length > 0 ? (
        <section aria-labelledby="active-invites" className="flex flex-col gap-2">
          <h3 id="active-invites" className="text-sm font-semibold text-fg-2">
            {parents.inviteActiveTitle}
          </h3>
          <ul className="flex flex-col gap-1 text-sm text-fg-muted">
            {data.invites.map((item) => (
              <li key={item.id}>
                {format(parents.inviteExpires, {
                  date: formatDate(locale, new Date(item.expiresAt)),
                })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <CreateChildSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onCreated={() => {
          setSheetOpen(false);
          setCreated(true);
          router.refresh();
        }}
        t={t}
        locale={locale}
      />
    </section>
  );
}
