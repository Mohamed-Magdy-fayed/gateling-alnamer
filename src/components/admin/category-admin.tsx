"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { type ReactNode, useActionState, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { type AuthText, idle, Message } from "@/components/auth-parts";
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
import type { FormState } from "@/server/auth/form-kit";
import {
  createCategoryAction,
  deleteCategoryAction,
  moveCategoryAction,
  updateCategoryAction,
} from "@/server/catalog/category-actions";
import { Badge, Button, Field, LoadingSwap, Ltr } from "@/ui";

type CategoriesText = Dictionary["categories"];

export type CategoryRowData = {
  id: string;
  nameAr: string;
  nameEn: string;
  slug: string;
  isSample: boolean;
  courseCount: number;
  /** The name in the viewer's language, for labels that name the row. */
  label: string;
};

/** Submit button that shows the spinner while its own form is pending. */
function Submit({
  children,
  variant,
  className,
  ...props
}: {
  children: ReactNode;
  variant?: "primary" | "outline" | "ghost" | "danger";
  className?: string;
  "aria-label"?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      className={className ?? "min-h-11"}
      disabled={pending}
      aria-busy={pending || undefined}
      {...props}
    >
      <LoadingSwap pending={pending}>{children}</LoadingSwap>
    </Button>
  );
}

function MoveButton({
  id,
  direction,
  label,
  disabled,
  action,
}: {
  id: string;
  direction: "up" | "down";
  label: string;
  disabled: boolean;
  action: (formData: FormData) => void;
}) {
  const Icon = direction === "up" ? ChevronUp : ChevronDown;
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <MoveSubmit
        label={label}
        disabled={disabled}
        icon={<Icon aria-hidden className="size-4" />}
      />
    </form>
  );
}

function MoveSubmit({
  label,
  disabled,
  icon,
}: {
  label: string;
  disabled: boolean;
  icon: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      className="min-h-11 min-w-11"
      aria-label={label}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
    >
      <LoadingSwap pending={pending}>{icon}</LoadingSwap>
    </Button>
  );
}

function RenameForm({
  t,
  auth,
  row,
  onDone,
}: {
  t: CategoriesText;
  auth: AuthText;
  row: CategoryRowData;
  onDone: () => void;
}) {
  const a = t.admin;
  const [state, action] = useActionState(updateCategoryAction, idle);
  const prefix = `rename-${row.id}`;
  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <Message
        state={state}
        t={auth}
        fieldIds={{ name_ar: `${prefix}-ar`, name_en: `${prefix}-en` }}
      />
      <input type="hidden" name="id" value={row.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id={`${prefix}-ar`}
          name="name_ar"
          label={a.nameAr}
          dir="rtl"
          lang="ar"
          maxLength={80}
          required
          defaultValue={state.values?.name_ar ?? row.nameAr}
          error={state.fieldErrors?.name_ar}
        />
        <Field
          id={`${prefix}-en`}
          name="name_en"
          label={a.nameEn}
          ltr
          lang="en"
          maxLength={80}
          required
          defaultValue={state.values?.name_en ?? row.nameEn}
          error={state.fieldErrors?.name_en}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Submit>{a.save}</Submit>
        <Button type="button" variant="outline" className="min-h-11" onClick={onDone}>
          {a.cancel}
        </Button>
      </div>
    </form>
  );
}

function DeleteButton({
  t,
  row,
  state,
  action,
}: {
  t: CategoriesText;
  row: CategoryRowData;
  state: FormState;
  action: (formData: FormData) => void;
}) {
  const a = t.admin;
  const [open, setOpen] = useState(false);
  // An error closes the dialog and the row shows the message, which takes focus (so the dialog
  // does not hand it back to the trigger). Success redirects with a notice.
  useEffect(() => {
    if (state.status === "error") setOpen(false);
  }, [state]);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11"
          aria-label={format(a.deleteLabel, { name: row.label })}
        >
          {a.delete}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (state.status === "error") event.preventDefault();
        }}
      >
        <form action={action} className="flex flex-col gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>{a.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {format(a.deleteBody, { name: row.label })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input type="hidden" name="id" value={row.id} />
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{a.cancel}</AlertDialogCancel>
            <Submit variant="danger">{a.delete}</Submit>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * One category: both names, its link name, how many courses use it, and the admin actions
 * (move among siblings, rename, delete after confirming).
 */
export function CategoryRow({
  t,
  auth,
  row,
  first,
  last,
  headingLevel,
}: {
  t: CategoriesText;
  auth: AuthText;
  row: CategoryRowData;
  first: boolean;
  last: boolean;
  /** Curricula are headings for their grades; other rows are plain text. */
  headingLevel?: "h3";
}) {
  const a = t.admin;
  const [moveState, moveAction] = useActionState(moveCategoryAction, idle);
  const [deleteState, deleteAction] = useActionState(deleteCategoryAction, idle);
  const [editing, setEditing] = useState(false);
  const Name = headingLevel ?? "p";
  const nameId = useId();
  return (
    <article className="flex flex-col gap-3" aria-labelledby={nameId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Name id={nameId} className="flex flex-wrap items-baseline gap-x-2 font-semibold">
            <bdi lang="ar" dir="rtl">
              {row.nameAr}
            </bdi>
            <span className="text-sm font-normal text-fg-2">
              <bdi lang="en" dir="ltr">
                {row.nameEn}
              </bdi>
            </span>
          </Name>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
            <span>
              {a.slugCaption}{" "}
              <Ltr wrap className="break-all">
                {row.slug}
              </Ltr>
            </span>
            <span>
              {a.coursesCaption} <Ltr>{row.courseCount}</Ltr>
            </span>
            {row.isSample ? <Badge tone="neutral">{a.sample}</Badge> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <MoveButton
            id={row.id}
            direction="up"
            label={format(a.moveUp, { name: row.label })}
            disabled={first}
            action={moveAction}
          />
          <MoveButton
            id={row.id}
            direction="down"
            label={format(a.moveDown, { name: row.label })}
            disabled={last}
            action={moveAction}
          />
          <Button
            variant="outline"
            size="sm"
            className="min-h-11"
            aria-expanded={editing}
            aria-label={format(a.renameLabel, { name: row.label })}
            onClick={() => setEditing((open) => !open)}
          >
            {a.rename}
          </Button>
          <DeleteButton t={t} row={row} state={deleteState} action={deleteAction} />
        </div>
      </div>
      <Message state={moveState} t={auth} />
      <Message state={deleteState} t={auth} />
      {editing ? <RenameForm t={t} auth={auth} row={row} onDone={() => setEditing(false)} /> : null}
    </article>
  );
}

/** Adds a curriculum, a subject, or a grade to one curriculum (`parentId`). */
export function AddCategoryForm({
  t,
  auth,
  type,
  parentId,
  title,
  headingLevel: Heading = "h3",
}: {
  t: CategoriesText;
  auth: AuthText;
  type: "curriculum" | "grade" | "subject";
  parentId?: string;
  title: string;
  headingLevel?: "h3" | "h4";
}) {
  const a = t.admin;
  const [state, action] = useActionState(createCategoryAction, idle);
  const prefix = `add-${type}-${parentId ?? "top"}`;
  const headingId = `${prefix}-title`;
  const ids = { name_ar: `${prefix}-ar`, name_en: `${prefix}-en`, slug: `${prefix}-slug` };
  return (
    <form action={action} aria-labelledby={headingId} className="flex flex-col gap-3" noValidate>
      <Heading id={headingId} className="font-semibold">
        {title}
      </Heading>
      <Message state={state} t={auth} fieldIds={ids} />
      <input type="hidden" name="type" value={type} />
      {parentId ? <input type="hidden" name="parent_id" value={parentId} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id={ids.name_ar}
          name="name_ar"
          label={a.nameAr}
          dir="rtl"
          lang="ar"
          maxLength={80}
          required
          defaultValue={state.values?.name_ar}
          error={state.fieldErrors?.name_ar}
        />
        <Field
          id={ids.name_en}
          name="name_en"
          label={a.nameEn}
          ltr
          lang="en"
          maxLength={80}
          required
          defaultValue={state.values?.name_en}
          error={state.fieldErrors?.name_en}
        />
      </div>
      <Field
        id={ids.slug}
        name="slug"
        label={a.slug}
        hint={a.slugHint}
        ltr
        maxLength={60}
        autoComplete="off"
        defaultValue={state.values?.slug}
        error={state.fieldErrors?.slug}
      />
      <Submit className="min-h-11 self-start">{a.add}</Submit>
    </form>
  );
}
