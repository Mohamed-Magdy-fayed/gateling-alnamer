"use client";

import { useMutation } from "@tanstack/react-query";
import { type Locale, plural } from "@/i18n/config";
import { useTRPC } from "@/lib/trpc/client";
import type { ParentChild } from "@/server/parents/dashboard";
import { Card, Ltr } from "@/ui";
import type { ParentTexts } from "./error-state";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { UnlinkDialog } from "./unlink-dialog";

type Props = {
  child: ParentChild;
  t: ParentTexts;
  locale: Locale;
  onChanged: () => void;
};

/** One child: name, username, age and masked email only, then the actions this link allows. */
export function ChildCard({ child, t, locale, onChanged }: Props) {
  const trpc = useTRPC();
  const unlink = useMutation(trpc.parent.children.unlink.mutationOptions());
  const parents = t.parents;
  const headingId = `child-${child.childId}`;
  // A reset by email needs an address; a parent-created child without one is reset directly.
  const canReset = child.resetMode === "direct" || child.maskedEmail !== null;
  // Only an admin removes the link to a child the parent created: it is that child's only recovery path.
  const canUnlink = child.source === "invite";

  return (
    <section aria-labelledby={headingId} className="h-full">
      <Card className="flex h-full flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h3 id={headingId} className="font-semibold break-words">
            <bdi>{child.displayName}</bdi>
          </h3>
          {child.username ? (
            <p className="text-sm text-fg-2">
              <Ltr>{child.username}</Ltr>
            </p>
          ) : null}
          <p className="flex flex-wrap items-center gap-x-3 text-sm text-fg-muted">
            {child.ageYears === null ? null : (
              <span>{plural(locale, parents.age, child.ageYears)}</span>
            )}
            {child.maskedEmail ? <Ltr>{child.maskedEmail}</Ltr> : null}
          </p>
        </div>
        <p className="text-sm text-fg-muted">{parents.progressPlaceholder}</p>
        {canReset || canUnlink ? (
          <div className="mt-auto flex flex-wrap gap-2">
            {canReset ? <ResetPasswordDialog child={child} t={t} /> : null}
            {canUnlink ? (
              <UnlinkDialog
                t={t}
                description={parents.unlinkConfirm}
                run={() => unlink.mutateAsync({ childId: child.childId })}
                onDone={onChanged}
              />
            ) : null}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
