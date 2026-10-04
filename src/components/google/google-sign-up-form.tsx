"use client";

import { useActionState, useState } from "react";
import { DateInput } from "@/components/al/date-input";
import { type AuthText, idle, Message } from "@/components/auth-parts";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { dirOf, type Locale } from "@/i18n/config";
import { isUnder18 } from "@/server/auth/age";
import { completeGoogleAction } from "@/server/auth/oauth/actions";
import { Alert, describedBy, Field } from "@/ui";
import { SubmitButton } from "@/ui/submit-button";

type Role = "student" | "parent";
const NO_FORM = "google-sign-up-role";

type Props = {
  t: AuthText;
  /** The submit label (google.create). */
  createLabel: string;
  locale: Locale;
  defaultName: string;
  deviceNotice: string;
};

/** The completion form for a new Google user: name, role, date of birth (and consent when needed). */
export function GoogleSignUpForm({ t, createLabel, locale, defaultName, deviceNotice }: Props) {
  const [state, action] = useActionState(completeGoogleAction, idle);
  const dir = dirOf(locale);
  const errors = state.fieldErrors ?? {};
  const [role, setRole] = useState<Role>(state.values?.role === "parent" ? "parent" : "student");
  const [dob, setDob] = useState(state.values?.date_of_birth ?? "");
  const needsConsent = role === "student" && dob !== "" && isUnder18(dob, new Date());
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Message state={state} t={t} />
      <fieldset className="flex flex-col gap-2">
        <input type="hidden" name="role" value={role} />
        <legend id="google-role-legend" className="mb-1.5 text-sm font-medium">
          {t.signUp.roleLegend}
        </legend>
        <RadioGroup
          form={NO_FORM}
          dir={dir}
          value={role}
          onValueChange={(value) => setRole(value === "parent" ? "parent" : "student")}
          aria-labelledby="google-role-legend"
          className="grid-cols-2"
        >
          {(["student", "parent"] as const).map((item) => (
            <RadioGroupItem key={item} value={item}>
              {t.signUp.roles[item]}
            </RadioGroupItem>
          ))}
        </RadioGroup>
        <div aria-live="polite">
          {role === "student" ? <Alert tone="info">{deviceNotice}</Alert> : null}
        </div>
      </fieldset>
      <Field
        name="name"
        label={t.fields.name}
        autoComplete="name"
        defaultValue={state.values?.name ?? defaultName}
        error={errors.name}
        required
        minLength={2}
      />
      <DateInput
        name="date_of_birth"
        legend={t.signUp.dob}
        labels={{ day: t.signUp.dobDay, month: t.signUp.dobMonth, year: t.signUp.dobYear }}
        locale={locale}
        dir={dir}
        defaultValue={dob}
        error={errors.date_of_birth}
        onValueChange={setDob}
        required
      />
      {needsConsent ? (
        <div className="flex flex-col gap-3">
          <Alert tone="info">{t.states.under18Consent}</Alert>
          <Label
            htmlFor="field-guardian_consent"
            className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 leading-6 font-normal"
          >
            <Checkbox
              id="field-guardian_consent"
              name="guardian_consent"
              aria-invalid={errors.guardian_consent ? true : undefined}
              aria-describedby={describedBy("field-guardian_consent", {
                error: errors.guardian_consent,
              })}
            />
            <span>{t.signUp.consent}</span>
          </Label>
          <p
            id="field-guardian_consent-error"
            aria-live="polite"
            className={errors.guardian_consent ? "text-sm text-destructive" : "sr-only"}
          >
            {errors.guardian_consent}
          </p>
        </div>
      ) : null}
      <SubmitButton>{createLabel}</SubmitButton>
    </form>
  );
}
