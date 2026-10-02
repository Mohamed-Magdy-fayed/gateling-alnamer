import type { LocalizedText } from "@/lib/localized-text";

export type CategoryType = "curriculum" | "grade" | "subject";
export type LessonKind = "video" | "pdf" | "image" | "quiz";

export type CourseAccess =
  | { kind: "fixed_end"; endAt: Date }
  | { kind: "duration_days"; days: number };

export type CatalogCategory = {
  id: string;
  type: CategoryType;
  slug: string;
  name: LocalizedText;
};

export type CatalogTeacher = {
  id: string;
  name: LocalizedText;
  bio: LocalizedText;
};

export type CourseSummary = {
  id: string;
  slug: string;
  title: LocalizedText;
  description: LocalizedText;
  priceMinor: number;
  access: CourseAccess;
  estimatedHours: number | null;
  teacher: CatalogTeacher;
  categories: CatalogCategory[];
};

export type CatalogLesson = {
  id: string;
  kind: LessonKind;
  title: LocalizedText;
  isFreePreview: boolean;
  durationMinutes: number | null;
};

export type CatalogSection = {
  id: string;
  title: LocalizedText;
  lessons: CatalogLesson[];
};

export type CourseDetail = CourseSummary & { sections: CatalogSection[] };

export type LessonView = {
  id: string;
  kind: LessonKind;
  title: LocalizedText;
  isFreePreview: boolean;
  durationMinutes: number | null;
  course: { slug: string; title: LocalizedText };
  sectionTitle: LocalizedText;
};

export type DashboardCourse = {
  id: string;
  slug: string;
  title: LocalizedText;
  teacher: LocalizedText;
  priceMinor: number;
  lessonCount: number;
  firstLessonId: string | null;
};
