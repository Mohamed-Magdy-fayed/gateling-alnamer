import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeCookieStore } from "../../../test/fake-cookies";

const h = vi.hoisted(() => ({
  store: null as unknown as FakeCookieStore,
  findSession: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => h.store }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/server/redis", () => ({ getRedis: () => null }));
vi.mock("@/server/auth/session-repo", () => ({
  findSession: h.findSession,
  insertSession: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteUserSessions: vi.fn(),
  setSessionDevice: vi.fn(),
}));
vi.mock("@/server/catalog/repository", () => ({
  getPublishedLesson: async () => ({
    id: "x",
    title: { en: "t", ar: "t" },
    course: { title: { en: "c", ar: "c" } },
  }),
}));
vi.mock("@/i18n/server", () => ({ getDictionary: async () => ({ t: {}, locale: "en" }) }));
vi.mock("@/server/devices/service", () => ({
  assertActiveDevice: async () => ({ ok: true }),
  touchDevice: async () => false,
}));

const LESSON = "3f1c1b7e-5d77-4a52-9d1e-0c2b4f6a7e11";
const { getCurrentUser } = await import("@/server/auth/session");
const { createTrpcContext } = await import("@/server/api/trpc");
const { default: LessonPage } = await import("@/app/(app)/dashboard/learn/[lessonId]/page");

beforeEach(() => {
  h.store = new FakeCookieStore();
  // Even a valid-looking pre-session cookie must change nothing.
  h.store.jar.set("presession", "a-valid-looking-pre-session-token");
  h.findSession.mockReset();
  h.findSession.mockResolvedValue(null);
});

describe("a pre-session-only request is signed out", () => {
  it("getCurrentUser returns null and never looks the cookie up as a session", async () => {
    expect(await getCurrentUser()).toBeNull();
    expect(h.findSession).not.toHaveBeenCalled();
  });

  it("the tRPC context has no user", async () => {
    const ctx = await createTrpcContext({ req: new Request("http://localhost/api/trpc/x") });
    expect(ctx.user).toBeNull();
  });

  it("the lesson page sends it to sign-in", async () => {
    await expect(LessonPage({ params: Promise.resolve({ lessonId: LESSON }) })).rejects.toThrow(
      "redirect:/sign-in",
    );
  });
});
