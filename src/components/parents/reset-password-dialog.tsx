"use client";

import { useMutation } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { type FormEvent, useState } from "react";
import { PasswordInput } from "@/components/al/password-input";
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
import { useTRPC } from "@/lib/trpc/client";
import type { FormState } from "@/server/auth/actions";
import type { ParentChild } from "@/server/parents/dashboard";
import { Alert, Button } from "@/ui";
import { errorState, type ParentTexts } from "./error-state";
import { IslandText } from "./island-text";

const PASSWORD_FIELD_ID = "field-newPassword";

type Done = "direct" | "email" | null;

/**
 * Reset a child's password. Direct mode (a child you created, or under 18 with no verified email)
 * asks for the new password; email mode sends a code to the child's email and only ever shows the mask.
 */
export function ResetPasswordDialog({ child, t }: { child: ParentChild; t: ParentTexts }) {
  const trpc = useTRPC();
  const mutation = useMutation(trpc.parent.children.resetPassword.mutationOptions());
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FormState>(idle);
  const [done, setDone] = useState<Done>(null);
  const parents = t.parents;
  const auth = t.auth;
  const direct = child.resetMode === "direct";
  const formId = `reset-${child.childId}`;
  const mask = child.maskedEmail ?? "";

  function send(newPassword?: string) {
    mutation.mutate(
      { childId: child.childId, newPassword },
      {
        onSuccess: (result) => {
          setState(idle);
          setDone(result.mode);
        },
        onError: (error) => setState(errorState(error, t)),
      },
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(String(new FormData(event.currentTarget).get("newPassword") ?? ""));
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setState(idle);
          setDone(null);
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="min-h-11">
          {parents.resetAction}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          // Direct mode: start in the password field instead of the Cancel button.
          const field = direct ? document.getElementById(PASSWORD_FIELD_ID) : null;
          if (!field) return;
          event.preventDefault();
          field.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            <IslandText template={parents.resetTitle} token="name" kind="name">
              {child.displayName}
            </IslandText>
          </AlertDialogTitle>
          {done === null ? (
            <AlertDialogDescription>
              {direct ? (
                parents.resetDirectHint
              ) : (
                <IslandText template={parents.resetEmailConfirm} token="email" wrap>
                  {mask}
                </IslandText>
              )}
            </AlertDialogDescription>
          ) : (
            <AlertDialogDescription className="sr-only">
              {parents.resetAction}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <Message state={state} t={auth} />
        {done === "direct" ? <Alert tone="success">{parents.resetDone}</Alert> : null}
        {done === "email" ? (
          <Alert tone="success">
            <IslandText template={parents.resetEmailSent} token="email" wrap>
              {mask}
            </IslandText>
          </Alert>
        ) : null}
        {done === null && direct ? (
          <form id={formId} onSubmit={submit} noValidate>
            <PasswordInput
              name="newPassword"
              label={parents.resetDirect}
              hint={auth.fields.passwordHint}
              toggleLabel={auth.fields.showPassword}
              autoComplete="new-password"
              required
            />
          </form>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11">
            {done === null ? parents.cancel : parents.close}
          </AlertDialogCancel>
          {done === null ? (
            <Button
              type={direct ? "submit" : "button"}
              form={direct ? formId : undefined}
              className="min-h-11"
              disabled={mutation.isPending}
              aria-busy={mutation.isPending}
              onClick={direct ? undefined : () => send()}
            >
              {mutation.isPending ? (
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
              ) : null}
              {direct ? parents.resetDirect : auth.forgot.submit}
            </Button>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
