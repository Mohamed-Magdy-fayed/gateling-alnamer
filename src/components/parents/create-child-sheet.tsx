"use client";

import { useMutation } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { type FormEvent, useState } from "react";
import { DateInput } from "@/components/al/date-input";
import { PasswordInput } from "@/components/al/password-input";
import { idle, Message } from "@/components/auth-parts";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Locale } from "@/i18n/config";
import { useTRPC } from "@/lib/trpc/client";
import type { FormState } from "@/server/auth/actions";
import { Button, Field } from "@/ui";
import { errorState, type ParentTexts } from "./error-state";

const FORM_ID = "create-child-form";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  t: ParentTexts;
  locale: Locale;
};

function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** The create-child form in a Sheet: scrollable body, submit pinned in the footer. */
export function CreateChildSheet({ open, onOpenChange, onCreated, t, locale }: Props) {
  const trpc = useTRPC();
  const mutation = useMutation(trpc.parent.children.create.mutationOptions());
  const [state, setState] = useState<FormState>(idle);
  const errors = state.fieldErrors ?? {};
  const auth = t.auth;
  const parents = t.parents;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate(
      {
        name: text(data, "name"),
        username: text(data, "username"),
        password: String(data.get("password") ?? ""),
        dateOfBirth: text(data, "date_of_birth"),
      },
      {
        onSuccess: () => {
          setState(idle);
          onCreated();
        },
        onError: (error) => setState(errorState(error, t)),
      },
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setState(idle);
        onOpenChange(next);
      }}
    >
      <SheetContent
        closeLabel={parents.close}
        aria-describedby={undefined}
        className="w-full gap-0 p-0 max-sm:max-w-none sm:max-w-md"
      >
        <SheetHeader className="border-b border-line p-4 pe-16">
          <SheetTitle>{parents.addChild}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          <form id={FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-4">
            <Message state={state} t={auth} />
            <Field
              name="name"
              label={auth.fields.name}
              autoComplete="off"
              error={errors.name}
              required
            />
            <Field
              name="username"
              label={parents.fieldUsername}
              hint={auth.signUp.usernameHint}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              ltr
              error={errors.username}
              required
            />
            <PasswordInput
              name="password"
              label={auth.fields.password}
              hint={auth.fields.passwordHint}
              toggleLabel={auth.fields.showPassword}
              autoComplete="new-password"
              error={errors.password}
              required
            />
            <DateInput
              name="date_of_birth"
              legend={auth.signUp.dob}
              labels={{
                day: auth.signUp.dobDay,
                month: auth.signUp.dobMonth,
                year: auth.signUp.dobYear,
              }}
              locale={locale}
              dir={locale === "ar" ? "rtl" : "ltr"}
              error={errors.date_of_birth}
              required
            />
          </form>
        </div>
        <div className="border-t border-line p-4">
          <Button
            type="submit"
            form={FORM_ID}
            size="lg"
            className="w-full"
            disabled={mutation.isPending}
            aria-busy={mutation.isPending}
          >
            {mutation.isPending ? (
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
            ) : null}
            {parents.addChild}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
