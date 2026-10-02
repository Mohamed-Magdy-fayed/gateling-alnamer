import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { hashPassword } from "./password";

const h = vi.hoisted(() => ({
  user: undefined as unknown,
  calls: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/i18n/server", () => ({
  getDictionary: async () => ({ t: en, locale: "en" as const }),
}));
vi.mock("@/server/db", () => ({
  db: () => ({ query: { users: { findFirst: async () => h.user } } }),
}));
vi.mock("@/server/jobs/send", () => ({ sendEvent: async () => undefined }));
vi.mock("./session", () => ({
  createSession: async (userId: string) => {
    h.calls.push(`create:${userId}`);
  },
  destroySession: async () => {
    h.calls.push("destroy");
  },
  invalidateUserSessions: async () => undefined,
}));

const { signInAction } = await import("./actions");

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  h.calls.length = 0;
  h.user = undefined;
});

describe("signInAction", () => {
  it("gives the same generic error for an unknown user and a wrong password", async () => {
    h.user = undefined;
    const unknown = await signInAction(
      { status: "idle" },
      form({ identifier: "nobody@example.test", password: "whatever pass 1" }),
    );

    h.user = {
      id: "u1",
      status: "active",
      credentials: { passwordHash: await hashPassword("right pass 1"), passwordSalt: null },
    };
    const wrong = await signInAction(
      { status: "idle" },
      form({ identifier: "nobody@example.test", password: "wrong pass 1" }),
    );

    expect(unknown).toEqual(wrong);
    expect(unknown).toMatchObject({ status: "error", message: en.auth.errors.credentials });
    expect(h.calls).toEqual([]);
  });

  it("destroys any existing session before creating the new one", async () => {
    h.user = {
      id: "u1",
      status: "active",
      credentials: { passwordHash: await hashPassword("right pass 1"), passwordSalt: null },
    };
    await expect(
      signInAction(
        { status: "idle" },
        form({ identifier: "u@example.test", password: "right pass 1" }),
      ),
    ).rejects.toThrow("redirect:/dashboard");
    expect(h.calls).toEqual(["destroy", "create:u1"]);
  });
});
