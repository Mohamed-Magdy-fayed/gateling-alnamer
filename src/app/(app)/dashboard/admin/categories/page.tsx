import { ChevronDown } from "lucide-react";
import {
  AddCategoryForm,
  CategoryRow,
  type CategoryRowData,
} from "@/components/admin/category-admin";
import { format } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { pickText } from "@/lib/localized-text";
import { requirePageRole } from "@/server/auth/page-guard";
import { type AdminCategory, listCategoriesForAdmin } from "@/server/catalog/categories";
import { Alert, Card, Container, Ltr } from "@/ui";

/** Admin categories (C3): curricula with their grades, and subjects; add, rename, order, delete. */
export default async function AdminCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  await requirePageRole("admin");
  const [{ t, locale }, tree, { done }] = await Promise.all([
    getDictionary(),
    listCategoriesForAdmin(),
    searchParams,
  ]);
  const a = t.categories.admin;
  const toRow = (category: AdminCategory): CategoryRowData => ({
    id: category.id,
    nameAr: category.name.ar ?? "",
    nameEn: category.name.en ?? "",
    slug: category.slug,
    isSample: category.isSample,
    courseCount: category.courseCount,
    label: pickText(category.name, locale),
  });
  const texts = { t: t.categories, auth: t.auth };
  return (
    <Container className="flex flex-col gap-8 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-balance">{a.title}</h1>
        <p className="max-w-prose text-fg-2">{a.intro}</p>
      </div>
      {done === "deleted" ? <Alert tone="success">{a.deleted}</Alert> : null}
      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <section aria-labelledby="curricula" className="flex flex-col gap-4">
          <h2 id="curricula" className="text-lg font-semibold">
            {a.curricula}
          </h2>
          {tree.curricula.length === 0 ? (
            <Card className="p-6 text-sm text-fg-muted">{a.noCurricula}</Card>
          ) : (
            <ul className="flex flex-col gap-4">
              {tree.curricula.map((curriculum, index) => (
                <li key={curriculum.id}>
                  <Card className="flex flex-col gap-4 p-5">
                    <CategoryRow
                      {...texts}
                      row={toRow(curriculum)}
                      first={index === 0}
                      last={index === tree.curricula.length - 1}
                      headingLevel="h3"
                    />
                    <details className="group border-t border-line pt-2">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md text-sm font-medium text-fg-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
                        <ChevronDown
                          aria-hidden
                          className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                        />
                        {a.grades} <Ltr>({curriculum.grades.length})</Ltr>
                      </summary>
                      <div className="flex flex-col gap-4 pt-2">
                        {curriculum.grades.length === 0 ? (
                          <p className="text-sm text-fg-muted">{a.noGrades}</p>
                        ) : (
                          <ul className="divide-y divide-line">
                            {curriculum.grades.map((grade, gradeIndex) => (
                              <li key={grade.id} className="py-3">
                                <CategoryRow
                                  {...texts}
                                  row={toRow(grade)}
                                  first={gradeIndex === 0}
                                  last={gradeIndex === curriculum.grades.length - 1}
                                />
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="border-t border-line pt-4">
                          <AddCategoryForm
                            {...texts}
                            type="grade"
                            parentId={curriculum.id}
                            title={format(a.addGrade, { name: pickText(curriculum.name, locale) })}
                            headingLevel="h4"
                          />
                        </div>
                      </div>
                    </details>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          <Card className="p-5">
            <AddCategoryForm {...texts} type="curriculum" title={a.addCurriculum} />
          </Card>
        </section>
        <section aria-labelledby="subjects" className="flex flex-col gap-4 self-start">
          <h2 id="subjects" className="text-lg font-semibold">
            {a.subjects}
          </h2>
          <Card className="flex flex-col gap-4 p-5">
            {tree.subjects.length === 0 ? (
              <p className="text-sm text-fg-muted">{a.noSubjects}</p>
            ) : (
              <ul className="divide-y divide-line">
                {tree.subjects.map((subject, index) => (
                  <li key={subject.id} className="py-3">
                    <CategoryRow
                      {...texts}
                      row={toRow(subject)}
                      first={index === 0}
                      last={index === tree.subjects.length - 1}
                    />
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-line pt-4">
              <AddCategoryForm {...texts} type="subject" title={a.addSubject} />
            </div>
          </Card>
        </section>
      </div>
    </Container>
  );
}
