"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTRPC } from "@/lib/trpc/client";
import type { LinkedParent } from "@/server/parents/views";
import { Card, Ltr } from "@/ui";
import type { ParentTexts } from "./error-state";
import { UnlinkDialog } from "./unlink-dialog";

/** The parents linked to this student, each with an unlink the link's source allows. */
export function LinkedParents({ parents, t }: { parents: LinkedParent[]; t: ParentTexts }) {
  const router = useRouter();
  const trpc = useTRPC();
  const unlink = useMutation(trpc.student.parentLinks.unlink.mutationOptions());
  const text = t.parents;

  return (
    <section aria-labelledby="linked-parents" className="flex flex-col gap-4">
      <h2 id="linked-parents" className="text-lg font-semibold">
        {text.linkedTitle}
      </h2>
      {parents.length === 0 ? (
        <p className="text-fg-muted">{text.linkedEmpty}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {parents.map((parent) => {
            const headingId = `parent-${parent.parentId}`;
            return (
              <li key={parent.parentId}>
                <section aria-labelledby={headingId} className="h-full">
                  <Card className="flex h-full flex-col gap-3 p-5">
                    <h3 id={headingId} className="font-semibold break-words">
                      <bdi>{parent.displayName}</bdi>
                    </h3>
                    {parent.maskedEmail ? (
                      <p className="text-sm text-fg-muted">
                        <Ltr wrap>{parent.maskedEmail}</Ltr>
                      </p>
                    ) : null}
                    {parent.source === "invite" ? (
                      <div className="mt-auto">
                        <UnlinkDialog
                          t={t}
                          name={parent.displayName}
                          description={text.unlinkStudentConfirm}
                          run={() => unlink.mutateAsync({ parentId: parent.parentId })}
                          onDone={() => router.refresh()}
                        />
                      </div>
                    ) : null}
                  </Card>
                </section>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
