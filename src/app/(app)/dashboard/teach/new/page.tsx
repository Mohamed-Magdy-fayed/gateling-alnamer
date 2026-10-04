import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NewCourseForm } from "@/components/teach/new-course-form";
import { getDictionary } from "@/i18n/server";
import { requirePageRole } from "@/server/auth/page-guard";
import { canAuthor } from "@/server/catalog/teachers/terms";
import { getPlatformSettings } from "@/server/settings/repository";
import { Container } from "@/ui";

export default async function NewCoursePage() {
  const user = await requirePageRole("teacher");
  // Not approved yet, or the terms still to accept: the dashboard shows what to do (C1).
  if (!(await canAuthor(user.id))) redirect("/dashboard");
  const [{ t }, settings] = await Promise.all([getDictionary(), getPlatformSettings()]);
  return (
    <Container className="py-8">
      <Link
        href="/dashboard"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-sm)] text-sm text-fg-2 hover:text-fg"
      >
        <ArrowRight aria-hidden className="size-4 ltr:rotate-180" strokeWidth={1.75} />
        {t.teach.backToCourses}
      </Link>
      <div className="mt-4 mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t.teach.newTitle}</h1>
        <p className="text-fg-2">{t.teach.newIntro}</p>
      </div>
      <div className="max-w-2xl">
        <NewCourseForm t={t.teach} currency={settings.currency} />
      </div>
    </Container>
  );
}
