"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { Dictionary } from "@/i18n/ar";
import { format } from "@/i18n/config";
import { useTRPC } from "@/lib/trpc/client";
import { draftCourseInput } from "@/server/catalog/authoring-input";
import { Alert, Button, Card, cn, describedBy, Field, FieldFrame, LoadingSwap } from "@/ui";

type TeachText = Dictionary["teach"];

type Props = {
  t: TeachText;
  /** The platform currency code, shown next to the price (LTR island). */
  currency: string;
};

type FieldName = "titleAr" | "titleEn" | "descriptionAr" | "price" | "accessDays" | "lessonTitleAr";

type Errors = Partial<Record<FieldName, string>>;

/** `teach.errors.titleLength` -> the text in `t.errors`. */
function messageFor(key: string, t: TeachText): string {
  const leaf = key.replace(/^teach\.errors\./, "") as keyof TeachText["errors"];
  return t.errors[leaf] ?? t.errorGeneric;
}

/** Same look as the Input component, as a multi-line field. */
const textareaClass = cn(
  "min-h-32 w-full rounded-sm border border-input bg-card px-3 py-2 text-foreground",
  "focus-visible:border-primary aria-invalid:border-destructive",
);

/** The draft course form: validated here with the server's schema, then created on the server. */
export function NewCourseForm({ t, currency }: Props) {
  const trpc = useTRPC();
  const router = useRouter();
  const create = useMutation(trpc.teach.create.mutationOptions());
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [freePreview, setFreePreview] = useState(false);
  const pending = create.isPending || create.isSuccess;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const data = new FormData(event.currentTarget);
    const text = (name: FieldName) => String(data.get(name) ?? "");
    const number = (name: FieldName) => {
      const raw = text(name).trim();
      return raw === "" ? Number.NaN : Number(raw);
    };
    const parsed = draftCourseInput.safeParse({
      titleAr: text("titleAr"),
      titleEn: text("titleEn"),
      descriptionAr: text("descriptionAr"),
      price: number("price"),
      accessDays: number("accessDays"),
      lessonTitleAr: text("lessonTitleAr"),
      freePreview,
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as FieldName | undefined;
        if (field && !next[field]) next[field] = messageFor(issue.message, t);
      }
      setErrors(next);
      const first = Object.keys(next)[0];
      if (first) document.getElementById(`field-${first}`)?.focus();
      return;
    }
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: (result) => {
        if (result.ok) {
          router.push(`/dashboard/teach/${result.courseId}`);
          return;
        }
        create.reset();
        setFormError(result.reason === "not_approved" ? t.notApproved : t.errorGeneric);
      },
      onError: () => setFormError(t.errorGeneric),
    });
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-lg font-semibold">{t.courseGroup}</h2>
        <Field name="titleAr" label={t.titleAr} error={errors.titleAr} required maxLength={120} />
        <Field name="titleEn" label={t.titleEn} error={errors.titleEn} maxLength={120} />
        <FieldFrame id="field-descriptionAr" label={t.descriptionAr} error={errors.descriptionAr}>
          <textarea
            id="field-descriptionAr"
            name="descriptionAr"
            required
            maxLength={2000}
            aria-invalid={errors.descriptionAr ? true : undefined}
            aria-describedby={describedBy("field-descriptionAr", { error: errors.descriptionAr })}
            className={textareaClass}
          />
        </FieldFrame>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-lg font-semibold">{t.priceGroup}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="price"
            label={format(t.price, { currency })}
            hint={t.priceHint}
            error={errors.price}
            inputMode="numeric"
            ltr
            required
          />
          <Field
            name="accessDays"
            label={t.accessDays}
            hint={t.accessHint}
            error={errors.accessDays}
            inputMode="numeric"
            defaultValue="90"
            ltr
            required
          />
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-lg font-semibold">{t.lessonGroup}</h2>
        <Field
          name="lessonTitleAr"
          label={t.lessonTitle}
          error={errors.lessonTitleAr}
          required
          maxLength={120}
        />
        <Label
          htmlFor="field-freePreview"
          className="flex min-h-11 cursor-pointer items-center gap-3 font-normal"
        >
          <Checkbox
            id="field-freePreview"
            checked={freePreview}
            onCheckedChange={(value) => setFreePreview(value === true)}
          />
          <span>{t.freePreview}</span>
        </Label>
        <p className="text-sm text-fg-muted">{t.lessonNote}</p>
      </Card>

      {formError ? <Alert tone="danger">{formError}</Alert> : null}
      <Button type="submit" size="lg" className="self-start" disabled={pending}>
        <LoadingSwap pending={pending}>{t.create}</LoadingSwap>
      </Button>
    </form>
  );
}
