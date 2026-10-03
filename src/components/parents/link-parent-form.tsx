"use client";

import { useMutation } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { InviteCodeInput } from "@/components/al/invite-code-input";
import { idle, Message } from "@/components/auth-parts";
import { useTRPC } from "@/lib/trpc/client";
import type { FormState } from "@/server/auth/actions";
import { Button } from "@/ui";
import { errorState, type ParentTexts } from "./error-state";
import { IslandText } from "./island-text";

/** The student's side of linking: type the parent's code, see the result, the list below refreshes. */
export function LinkParentForm({ t }: { t: ParentTexts }) {
  const router = useRouter();
  const trpc = useTRPC();
  const mutation = useMutation(trpc.student.parentLinks.redeem.mutationOptions());
  const [state, setState] = useState<FormState>(idle);
  const parents = t.parents;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const code = String(new FormData(form).get("code") ?? "");
    mutation.mutate(
      { code },
      {
        onSuccess: () => {
          form.reset();
          setState({ status: "success", message: parents.linked });
          router.refresh();
        },
        onError: (error) => setState(errorState(error, t)),
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-md flex-col gap-4">
      <Message state={state} t={t.auth} />
      <InviteCodeInput
        name="code"
        label={parents.linkLabel}
        hint={
          <IslandText template={parents.linkHint} token="example">
            ABCD-2345
          </IslandText>
        }
        required
      />
      <Button type="submit" size="lg" disabled={mutation.isPending} aria-busy={mutation.isPending}>
        {mutation.isPending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
        {parents.linkSubmit}
      </Button>
    </form>
  );
}
