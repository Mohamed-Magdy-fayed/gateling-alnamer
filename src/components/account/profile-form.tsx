"use client";

import { useMutation } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { type AuthText, idle, Message } from "@/components/auth-parts";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setLocaleAction } from "@/i18n/actions";
import type { Dictionary } from "@/i18n/ar";
import { isLocale, type Locale } from "@/i18n/config";
import { useTRPC } from "@/lib/trpc/client";
import type { FormState } from "@/server/auth/actions";
import { Button, Field } from "@/ui";
import { accountErrorState } from "./error-state";

type AccountText = Dictionary["account"];

type Props = {
  t: AccountText;
  authT: AuthText;
  name: string;
  /** The saved preference, or the interface language when none is saved. */
  locale: Locale;
  dir: "rtl" | "ltr";
};

const LANGUAGE_ID = "field-locale";

/** Display name and language. The language also sets the interface cookie, so the page follows. */
export function ProfileForm({ t, authT, name, locale, dir }: Props) {
  const router = useRouter();
  const trpc = useTRPC();
  const mutation = useMutation(trpc.account.updateProfile.mutationOptions());
  const [chosen, setChosen] = useState<Locale>(locale);
  // The success text is derived at render so it reads in the new language after the refresh.
  const [outcome, setOutcome] = useState<"saved" | FormState>(idle);
  const state = useMemo<FormState>(
    () => (outcome === "saved" ? { status: "success", message: t.saved } : outcome),
    [outcome, t.saved],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate(
      { name: String(data.get("name") ?? "").trim(), locale: chosen },
      {
        onSuccess: async () => {
          const body = new FormData();
          body.set("locale", chosen);
          await setLocaleAction(body);
          setOutcome("saved");
          router.refresh();
        },
        onError: (error) => setOutcome(accountErrorState(error, authT)),
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-md flex-col gap-4">
      <Message state={state} t={authT} />
      <Field
        name="name"
        label={authT.fields.name}
        defaultValue={name}
        autoComplete="name"
        required
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={LANGUAGE_ID}>{t.languageLabel}</Label>
        <Select
          dir={dir}
          value={chosen}
          onValueChange={(next) => {
            if (isLocale(next)) setChosen(next);
          }}
        >
          <SelectTrigger id={LANGUAGE_ID}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ar" lang="ar">
              {t.languageAr}
            </SelectItem>
            <SelectItem value="en" lang="en">
              {t.languageEn}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" size="lg" disabled={mutation.isPending} aria-busy={mutation.isPending}>
        {mutation.isPending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
        {t.save}
      </Button>
    </form>
  );
}
