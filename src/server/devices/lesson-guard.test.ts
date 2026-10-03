import { beforeEach, describe, expect, it, vi } from "vitest";

// The learn page's wiring to the single access decision. `getLessonAccess` itself (entitlements,
// devices, roles) is covered by src/server/access/lesson-access.int.test.ts.
const h = vi.hoisted(() => ({
  session: null as null | {
    tokenHash: string;
    deviceId: string | null;
    user: { id: string; name: string; email: string | null; role: string; status: string };
  },
  access: { allowed: true, grant: {} } as
    | { allowed: true; grant: object }
    | { allowed: false; reason: string },
  accessArgs: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/server/auth/session", () => ({
  getCurrentSession: async () => h.session,
  requireUser: async () => h.session?.user,
  getCurrentUser: async () => h.session?.user ?? null,
}));
vi.mock("@/server/catalog/repository", () => ({
  getPublishedLesson: async () => ({
    id: "x",
    title: { en: "Lesson", ar: "درس" },
    course: { slug: "course", title: { en: "Course", ar: "دورة" } },
  }),
}));
vi.mock("@/i18n/server", () => ({
  getDictionary: async () => ({
    t: {
      dashboard: { player: {} },
      common: {},
      parents: { cannotPlay: "cannot play" },
      orders: { noAccess: "no access", accessEnded: "ended", accessStopped: "stopped" },
    },
    locale: "en" as const,
  }),
}));
vi.mock("@/server/auth/profile", () => ({
  watermarkNumber: async () => "AN-000123",
}));
vi.mock("@/server/access/lesson-access", () => ({
  getLessonAccess: async (...args: unknown[]) => {
    h.accessArgs.push(args.slice(0, 2));
    return h.access;
  },
}));

const LESSON = "3f1c1b7e-5d77-4a52-9d1e-0c2b4f6a7e11";
const { default: LessonPage } = await import("@/app/(app)/dashboard/learn/[lessonId]/page");
const render = () => LessonPage({ params: Promise.resolve({ lessonId: LESSON }) });

function sessionFor(role: string, deviceId: string | null) {
  return {
    tokenHash: "h",
    deviceId,
    user: { id: "u1", name: "Sam", email: null, role, status: "active" },
  };
}

beforeEach(() => {
  h.access = { allowed: true, grant: {} };
  h.accessArgs = [];
  h.session = sessionFor("student", null);
});

describe("lesson page access wiring", () => {
  it("passes the session's user, role and device to the access decision", async () => {
    h.session = sessionFor("student", "dev-1");
    await render();
    expect(h.accessArgs).toEqual([[{ id: "u1", role: "student", deviceId: "dev-1" }, LESSON]]);
  });

  it("sends an inactive device through /devices/check and back to the lesson", async () => {
    h.access = { allowed: false, reason: "device_inactive" };
    const next = encodeURIComponent(`/dashboard/learn/${LESSON}`);
    await expect(render()).rejects.toThrow(`redirect:/devices/check?next=${next}`);
  });

  it("renders the lesson when access is granted", async () => {
    await expect(render()).resolves.toBeTruthy();
  });

  it("answers not found for an unknown or unpublished lesson", async () => {
    h.access = { allowed: false, reason: "not_found" };
    await expect(render()).rejects.toThrow("notFound");
    h.access = { allowed: false, reason: "not_published" };
    await expect(render()).rejects.toThrow("notFound");
  });

  it("shows a notice (not the lesson) for a parent or a student without access", async () => {
    for (const reason of ["parent", "no_entitlement", "expired", "revoked"]) {
      h.access = { allowed: false, reason };
      await expect(render(), reason).resolves.toBeTruthy();
    }
  });

  it("sends a signed-out visitor to sign-in", async () => {
    h.session = null;
    await expect(render()).rejects.toThrow("redirect:/sign-in");
  });
});
