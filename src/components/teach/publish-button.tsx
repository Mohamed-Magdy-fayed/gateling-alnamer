"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { Alert, Button, LoadingSwap } from "@/ui";

type TeachText = Dictionary["teach"];

/** "Publish" behind a confirm dialog that names the course (admin review card). */
export function PublishButton({
  courseId,
  title,
  t,
}: {
  courseId: string;
  /** The course title in the viewer's language, for the dialog. */
  title: string;
  t: TeachText;
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const publish = useMutation(trpc.admin.content.publish.mutationOptions());
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  function run() {
    publish.mutate(
      { courseId },
      {
        onSuccess: (result) => {
          setOpen(false);
          setFailed(!result.ok);
          router.refresh();
        },
        onError: () => {
          setOpen(false);
          setFailed(true);
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button size="sm" className="min-h-11">
            {t.publish}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{format(t.publishTitle, { title })}</AlertDialogTitle>
            <AlertDialogDescription>{t.publishBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t.cancel}</AlertDialogCancel>
            <Button className="min-h-11" disabled={publish.isPending} onClick={run}>
              <LoadingSwap pending={publish.isPending}>{t.publish}</LoadingSwap>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {failed ? <Alert tone="danger">{t.errorGeneric}</Alert> : null}
    </div>
  );
}
