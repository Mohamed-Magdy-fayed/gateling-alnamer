"use client";

import { useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Locale } from "@/i18n/config";
import { describedBy } from "@/ui";

const FIRST_YEAR = 1940;
/** Points the selects at a form id that does not exist, so a form reset cannot touch them (the hidden input submits the value). */
const NO_FORM = "date-input-detached";
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

type DateInputProps = {
  /** Name of the hidden field that submits `YYYY-MM-DD` (empty until all three parts are chosen). */
  name: string;
  legend: string;
  labels: { day: string; month: string; year: string };
  locale: Locale;
  dir: "rtl" | "ltr";
  defaultValue?: string;
  error?: string;
  required?: boolean;
  onValueChange?: (iso: string) => void;
};

type Parts = { day: string; month: string; year: string };

function split(iso: string | undefined): Parts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return match
    ? {
        year: String(Number(match[1])),
        month: String(Number(match[2])),
        day: String(Number(match[3])),
      }
    : { day: "", month: "", year: "" };
}

function daysIn(year: string, month: string): number {
  if (!month) return 31;
  // Day 0 of the next month is the last day of this one; a missing year uses a leap year.
  return new Date(Date.UTC(year ? Number(year) : 2000, Number(month), 0)).getUTCDate();
}

const pad = (value: string) => value.padStart(2, "0");

/** Date of birth as three selects (day, month, year): no calendar popup. The grid follows the writing direction, so the day sits at the inline-start edge in both locales. */
export function DateInput({
  name,
  legend,
  labels,
  locale,
  dir,
  defaultValue,
  error,
  required,
  onValueChange,
}: DateInputProps) {
  const [parts, setParts] = useState<Parts>(() => split(defaultValue));
  const id = `field-${name}`;

  const monthNames = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn-ca-gregory" : "en", {
      month: "long",
      timeZone: "UTC",
    });
    return MONTHS.map((month) => formatter.format(new Date(Date.UTC(2000, month - 1, 1))));
  }, [locale]);
  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: current - FIRST_YEAR + 1 }, (_, index) => String(current - index));
  }, []);

  const maxDay = daysIn(parts.year, parts.month);
  const complete = parts.day !== "" && parts.month !== "" && parts.year !== "";
  const iso = complete ? `${parts.year}-${pad(parts.month)}-${pad(parts.day)}` : "";

  function update(next: Parts) {
    const last = daysIn(next.year, next.month);
    const day = next.day !== "" && Number(next.day) > last ? String(last) : next.day;
    const fixed = { ...next, day };
    setParts(fixed);
    const done = fixed.day !== "" && fixed.month !== "" && fixed.year !== "";
    onValueChange?.(done ? `${fixed.year}-${pad(fixed.month)}-${pad(fixed.day)}` : "");
  }

  const invalid = error ? true : undefined;
  const mandatory = required ? true : undefined;
  const describedby = describedBy(id, { error });
  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={describedby}>
      <legend className="mb-1.5 text-sm font-medium text-foreground">{legend}</legend>
      <input type="hidden" name={name} value={iso} />
      <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-[1fr_1.6fr_1.2fr]">
        <Select
          form={NO_FORM}
          dir={dir}
          value={parts.day}
          onValueChange={(day) => update({ ...parts, day })}
        >
          <SelectTrigger
            id={id}
            aria-label={labels.day}
            aria-invalid={invalid}
            aria-required={mandatory}
            aria-describedby={describedby}
          >
            <SelectValue placeholder={labels.day} />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: maxDay }, (_, index) => String(index + 1)).map((day) => (
              <SelectItem key={day} value={day}>
                {day}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          form={NO_FORM}
          dir={dir}
          value={parts.month}
          onValueChange={(month) => update({ ...parts, month })}
        >
          <SelectTrigger
            aria-label={labels.month}
            aria-invalid={invalid}
            aria-required={mandatory}
            aria-describedby={describedby}
          >
            <SelectValue placeholder={labels.month} />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((month, index) => (
              <SelectItem key={month} value={String(month)}>
                {monthNames[index]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          form={NO_FORM}
          dir={dir}
          value={parts.year}
          onValueChange={(year) => update({ ...parts, year })}
        >
          <SelectTrigger
            aria-label={labels.year}
            aria-invalid={invalid}
            aria-required={mandatory}
            aria-describedby={describedby}
          >
            <SelectValue placeholder={labels.year} />
          </SelectTrigger>
          <SelectContent>
            {years.map((year) => (
              <SelectItem key={year} value={year}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p
        id={`${id}-error`}
        aria-live="polite"
        className={error ? "text-sm text-destructive" : "sr-only"}
      >
        {error}
      </p>
    </fieldset>
  );
}
