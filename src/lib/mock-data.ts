// Sample data for the client demo. Clearly labelled "sample" in the UI; no real people,
// metrics or customers. Replaced by the database in the real build (MASTER-PLAN phase C).
import type { Locale } from "@/i18n/config";

type Text = Record<Locale, string>;

export type MockLesson = {
  id: string;
  title: Text;
  kind: "video" | "pdf" | "quiz";
  minutes: number;
  free: boolean;
};

export type MockCourse = {
  slug: string;
  title: Text;
  teacher: Text;
  teacherBio: Text;
  curriculum: Text;
  grade: Text;
  subject: Text;
  priceMinor: number;
  access: { kind: "until"; date: string } | { kind: "days"; days: number };
  hours: number;
  description: Text;
  sections: { title: Text; lessons: MockLesson[] }[];
};

const lessons = (prefix: string, titles: [string, string][], freeFirst = true): MockLesson[] =>
  titles.map(([arTitle, enTitle], index) => ({
    id: `${prefix}-${index + 1}`,
    title: { ar: arTitle, en: enTitle },
    kind: index === titles.length - 1 ? "quiz" : index === 1 ? "pdf" : "video",
    minutes: 12 + index * 4,
    free: freeFirst && index === 0,
  }));

export const mockCourses: MockCourse[] = [
  {
    slug: "math-grade-12-calculus",
    title: { ar: "التفاضل والتكامل للصف الثاني عشر", en: "Grade 12 Calculus" },
    teacher: { ar: "أ. معلم تجريبي 1", en: "Sample Teacher 1" },
    teacherBio: {
      ar: "معلم رياضيات تجريبي لعرض صفحة المعلم.",
      en: "A sample mathematics teacher to show the teacher page.",
    },
    curriculum: { ar: "منهج وزارة التربية الإماراتية", en: "UAE Ministry of Education" },
    grade: { ar: "الصف الثاني عشر", en: "Grade 12" },
    subject: { ar: "الرياضيات", en: "Mathematics" },
    priceMinor: 45000,
    access: { kind: "until", date: "2027-06-30" },
    hours: 18,
    description: {
      ar: "شرح منظم للنهايات والاشتقاق والتكامل مع أمثلة محلولة واختبار في نهاية كل وحدة.",
      en: "A structured walk through limits, derivatives and integrals with worked examples and a quiz after each unit.",
    },
    sections: [
      {
        title: { ar: "الوحدة الأولى: النهايات", en: "Unit 1: Limits" },
        lessons: lessons("m1", [
          ["مقدمة في النهايات", "Introduction to limits"],
          ["ملخص قوانين النهايات", "Limit laws summary"],
          ["النهايات عند اللانهاية", "Limits at infinity"],
          ["اختبار الوحدة الأولى", "Unit 1 quiz"],
        ]),
      },
      {
        title: { ar: "الوحدة الثانية: الاشتقاق", en: "Unit 2: Derivatives" },
        lessons: lessons(
          "m2",
          [
            ["تعريف المشتقة", "Defining the derivative"],
            ["جدول قواعد الاشتقاق", "Derivative rules table"],
            ["قاعدة السلسلة", "The chain rule"],
            ["اختبار الوحدة الثانية", "Unit 2 quiz"],
          ],
          false,
        ),
      },
    ],
  },
  {
    slug: "physics-grade-11-mechanics",
    title: { ar: "الميكانيكا للصف الحادي عشر", en: "Grade 11 Mechanics" },
    teacher: { ar: "أ. معلم تجريبي 2", en: "Sample Teacher 2" },
    teacherBio: {
      ar: "معلم فيزياء تجريبي لعرض صفحة المعلم.",
      en: "A sample physics teacher to show the teacher page.",
    },
    curriculum: { ar: "المنهج السعودي", en: "Saudi curriculum" },
    grade: { ar: "الصف الحادي عشر", en: "Grade 11" },
    subject: { ar: "الفيزياء", en: "Physics" },
    priceMinor: 38000,
    access: { kind: "days", days: 120 },
    hours: 14,
    description: {
      ar: "الحركة والقوى والطاقة بأسلوب مبسط وتجارب مصورة.",
      en: "Motion, forces and energy explained simply, with filmed experiments.",
    },
    sections: [
      {
        title: { ar: "الحركة في بعد واحد", en: "Motion in one dimension" },
        lessons: lessons("p1", [
          ["الإزاحة والسرعة", "Displacement and velocity"],
          ["ورقة عمل التسارع", "Acceleration worksheet"],
          ["السقوط الحر", "Free fall"],
          ["اختبار قصير", "Short quiz"],
        ]),
      },
    ],
  },
  {
    slug: "chemistry-grade-10-foundations",
    title: { ar: "أساسيات الكيمياء للصف العاشر", en: "Grade 10 Chemistry Foundations" },
    teacher: { ar: "أ. معلم تجريبي 3", en: "Sample Teacher 3" },
    teacherBio: {
      ar: "معلم كيمياء تجريبي لعرض صفحة المعلم.",
      en: "A sample chemistry teacher to show the teacher page.",
    },
    curriculum: { ar: "المنهج البريطاني", en: "British curriculum" },
    grade: { ar: "الصف العاشر", en: "Grade 10" },
    subject: { ar: "الكيمياء", en: "Chemistry" },
    priceMinor: 32000,
    access: { kind: "until", date: "2027-06-15" },
    hours: 10,
    description: {
      ar: "الذرة والجدول الدوري والروابط الكيميائية بخطوات واضحة.",
      en: "Atoms, the periodic table and chemical bonding in clear steps.",
    },
    sections: [
      {
        title: { ar: "بنية الذرة", en: "Atomic structure" },
        lessons: lessons("c1", [
          ["مكونات الذرة", "Inside the atom"],
          ["ملخص الجدول الدوري", "Periodic table summary"],
          ["التوزيع الإلكتروني", "Electron configuration"],
          ["اختبار الوحدة", "Unit quiz"],
        ]),
      },
    ],
  },
  {
    slug: "english-grade-9-writing",
    title: { ar: "الكتابة باللغة الإنجليزية للصف التاسع", en: "Grade 9 English Writing" },
    teacher: { ar: "أ. معلم تجريبي 4", en: "Sample Teacher 4" },
    teacherBio: {
      ar: "معلم لغة إنجليزية تجريبي لعرض صفحة المعلم.",
      en: "A sample English teacher to show the teacher page.",
    },
    curriculum: { ar: "المنهج الأمريكي", en: "American curriculum" },
    grade: { ar: "الصف التاسع", en: "Grade 9" },
    subject: { ar: "اللغة الإنجليزية", en: "English" },
    priceMinor: 27500,
    access: { kind: "days", days: 90 },
    hours: 8,
    description: {
      ar: "كتابة الفقرة والمقال خطوة بخطوة مع نماذج وتصحيح.",
      en: "Writing paragraphs and essays step by step, with models and feedback.",
    },
    sections: [
      {
        title: { ar: "الفقرة المتماسكة", en: "The coherent paragraph" },
        lessons: lessons("e1", [
          ["الجملة الافتتاحية", "The topic sentence"],
          ["نموذج فقرة", "Sample paragraph"],
          ["أدوات الربط", "Linking words"],
          ["اختبار قصير", "Short quiz"],
        ]),
      },
    ],
  },
];

export function findCourse(slug: string): MockCourse | undefined {
  return mockCourses.find((course) => course.slug === slug);
}

export function lessonCount(course: MockCourse): number {
  return course.sections.reduce((sum, section) => sum + section.lessons.length, 0);
}

/** Money is integer minor units (MASTER-PLAN T15). AED has 2 decimals. */
export function formatPrice(locale: Locale, minor: number, currency: string): string {
  const amount = new Intl.NumberFormat(locale === "ar" ? "ar-u-nu-latn" : "en", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(minor / 100);
  return `${amount} ${currency}`;
}
