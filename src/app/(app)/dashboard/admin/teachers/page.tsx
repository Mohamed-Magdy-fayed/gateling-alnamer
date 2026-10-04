import { ApplicationReview } from "@/components/teach/application-review";
import { InviteForm } from "@/components/teach/invite-form";
import { format, formatDate } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { requirePageRole } from "@/server/auth/page-guard";
import { listTeacherApplications } from "@/server/catalog/teachers/review";
import { Alert, Badge, Card, Container, Ltr } from "@/ui";

/** Admin teachers (C1): pending applications with approve or reject, and the invite form. */
export default async function AdminTeachersPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  await requirePageRole("admin");
  const [{ t, locale }, applications, { done }] = await Promise.all([
    getDictionary(),
    listTeacherApplications(),
    searchParams,
  ]);
  const a = t.teachers.admin;
  const notice = done === "approved" ? a.approved : done === "rejected" ? a.rejected : null;
  return (
    <Container className="flex flex-col gap-8 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{a.title}</h1>
        <p className="max-w-prose text-fg-2">{a.intro}</p>
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <section aria-labelledby="applications" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="applications" className="text-lg font-semibold">
              {a.applications}
            </h2>
            <Badge tone="warning">
              <Ltr>{applications.length}</Ltr>
            </Badge>
          </div>
          {applications.length === 0 ? (
            <Card className="p-6 text-sm text-fg-muted">{a.empty}</Card>
          ) : (
            <ul className="flex flex-col gap-4">
              {applications.map((application) => (
                <li key={application.teacherId}>
                  <ApplicationReview
                    t={t.teachers}
                    auth={t.auth}
                    teacherId={application.teacherId}
                    name={application.name}
                    email={application.email}
                    note={application.note}
                    appliedOn={format(a.appliedOn, {
                      date: formatDate(locale, application.appliedAt),
                    })}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="invite" className="flex flex-col gap-4 self-start">
          <h2 id="invite" className="text-lg font-semibold">
            {a.inviteTitle}
          </h2>
          <Card className="flex flex-col gap-4 p-6">
            <p className="text-sm text-fg-2">{a.inviteIntro}</p>
            <InviteForm t={t.teachers} auth={t.auth} />
          </Card>
        </section>
      </div>
    </Container>
  );
}
