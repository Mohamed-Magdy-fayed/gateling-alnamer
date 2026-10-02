"use client";

import { useActionState } from "react";
import { signOutOthersAction } from "@/app/(app)/dashboard/account/actions";
import { type AuthText, idle, Message } from "@/components/auth-parts";
import { SubmitButton } from "@/ui/submit-button";

export function SignOutOthersForm({ label, authT }: { label: string; authT: AuthText }) {
  const [state, action] = useActionState(signOutOthersAction, idle);
  return (
    <form action={action} className="flex max-w-md flex-col gap-4">
      <Message state={state} t={authT} />
      <SubmitButton variant="secondary">{label}</SubmitButton>
    </form>
  );
}
