"use client";

import { useMutation } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { idle, Message } from "@/components/auth-parts";
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
import type { FormState } from "@/server/auth/actions";
import { Button } from "@/ui";
import { errorState, type ParentTexts } from "./error-state";
import { IslandText } from "./island-text";

type Props = {
  t: ParentTexts;
  /** Who is being unlinked; named in the dialog title. */
  name: string;
  /** The confirm sentence: who loses what. */
  description: string;
  /** Calls the unlink procedure; a failure is shown inside the dialog. */
  run: () => Promise<unknown>;
  /** Runs after a successful unlink (refresh the list). */
  onDone: () => void;
};

/** Confirm-then-unlink. The dialog stays open on a failure so the message can be read. */
export function UnlinkDialog({ t, name, description, run, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FormState>(idle);
  const mutation = useMutation({ mutationFn: run });
  const parents = t.parents;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setState(idle);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="min-h-11">
          {parents.unlink}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <IslandText template={parents.unlinkTitle} token="name" kind="name">
              {name}
            </IslandText>
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <Message state={state} t={t.auth} />
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11">{parents.cancel}</AlertDialogCancel>
          <Button
            variant="danger"
            className="min-h-11"
            disabled={mutation.isPending}
            aria-busy={mutation.isPending}
            onClick={() =>
              mutation.mutate(undefined, {
                onSuccess: () => {
                  setOpen(false);
                  onDone();
                },
                onError: (error) => setState(errorState(error, t)),
              })
            }
          >
            {mutation.isPending ? (
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
            ) : null}
            {parents.unlink}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
