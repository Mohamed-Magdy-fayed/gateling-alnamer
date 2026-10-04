import { notFound } from "next/navigation";
import { cache } from "react";
import { CourseCard } from "@/components/courses/course-card";
import { getDictionary } from "@/i18n/server";
import { pickText } from "@/lib/localized-text";
import { publicTeacherProfile } from "@/server/catalog/teachers/profile";
import { Badge, Card, Container } from "@/ui";

type Params = { params: Promise<{ publicNumber: string }> };

// One lookup per request, shared by the metadata and the page.
const loadProfile = cache(publicTeacherProfile);

export async function generateMetadata({ params }: Params) {
  const { publicNumber } = await params;
  const [profile, { locale }] = await Promise.all([loadProfile(publicNumber), getDictionary()]);
  return profile ? { title: pickText(profile.publicName, locale) } : {};
}

/** The public teacher page (C1): approved teachers only; name, bio and published courses. */
export default async function TeacherProfilePage({ params }: Params) {
  const { publicNumber } = await params;
  const profile = await loadProfile(publicNumber);
  if (!profile) notFound();
  const { t, locale } = await getDictionary();
  const p = t.teachers.profile;
  const bio = pickText(profile.bio, locale);
  return (
    <Container size="marketing" className="flex flex-col gap-10 py-10 md:py-14">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="primary">{p.teacher}</Badge>
          {profile.isSample ? <Badge tone="highlight">{t.common.sample}</Badge> : null}
        </div>
        <h1 className="text-[clamp(1.875rem,1.5rem+1.6vw,2.5rem)] font-bold text-balance">
          <bdi>{pickText(profile.publicName, locale)}</bdi>
        </h1>
        {bio ? (
          <p className="max-w-prose text-lg leading-[1.8] whitespace-pre-line text-fg-2">
            <bdi>{bio}</bdi>
          </p>
        ) : null}
      </header>
      <section aria-labelledby="teacher-courses" className="flex flex-col gap-5">
        <h2 id="teacher-courses" className="text-xl font-semibold">
          {p.courses}
        </h2>
        {profile.courses.length === 0 ? (
          <Card className="border-dashed p-8 text-center text-fg-2">{p.noCourses}</Card>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {profile.courses.map((course) => (
              <li key={course.slug}>
                <CourseCard t={t} locale={locale} course={course} headingLevel="h3" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </Container>
  );
}
