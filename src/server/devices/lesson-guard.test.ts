import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: null as null | {
    tokenHash: string;
    deviceId: string | null;
    user: { id: string; name: string; email: string | null; role: string; status: string };
  },
  check: { ok: true } as { ok: true } | { ok: false; reason: "needs_check" | "device_inactive" },
  assertArgs: [] as unknown[],
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
}));
vi.mock("@/server/catalog/repository", () => ({
  getPublishedLesson: async () => ({
    id: "x",
    title: { en: "Lesson", ar: "درس" },
    course: { title: { en: "Course", ar: "دورة" } },
  }),
}));
vi.mock("@/i18n/server", () => ({
  getDictionary: async () => ({
    t: { dashboard: { player: {} }, common: {} },
    locale: "en" as const,
  }),
}));
vi.mock("@/server/devices/service", () => ({
  assertActiveDevice: async (session: unknown) => {
    h.assertArgs.push(session);
    return h.check;
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
  h.check = { ok: true };
  h.assertArgs = [];
  h.session = sessionFor("student", null);
});

describe("lesson page device guard", () => {
  it("sends a student with no device through /devices/check and back to the lesson", async () => {
    h.check = { ok: false, reason: "needs_check" };
    const next = encodeURIComponent(`/dashboard/learn/${LESSON}`);
    await expect(render()).rejects.toThrow(`redirect:/devices/check?next=${next}`);
    expect(h.assertArgs).toEqual([{ role: "student", deviceId: null }]);
  });

  it("treats a revoked device the same way, so the check re-registers or blocks it", async () => {
    h.session = sessionFor("student", "dev-1");
    h.check = { ok: false, reason: "device_inactive" };
    const next = encodeURIComponent(`/dashboard/learn/${LESSON}`);
    await expect(render()).rejects.toThrow(`redirect:/devices/check?next=${next}`);
  });

  it("renders for a student with an active device", async () => {
    h.session = sessionFor("student", "dev-1");
    await expect(render()).resolves.toBeTruthy();
  });

  it("asks the guard about non-students too (it passes them)", async () => {
    h.session = sessionFor("teacher", null);
    await expect(render()).resolves.toBeTruthy();
    expect(h.assertArgs).toEqual([{ role: "teacher", deviceId: null }]);
  });

  it("sends a signed-out visitor to sign-in", async () => {
    h.session = null;
    await expect(render()).rejects.toThrow("redirect:/sign-in");
  });
});
