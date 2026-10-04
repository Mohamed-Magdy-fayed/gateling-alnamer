import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";

const TEACHER = "0192f0e2-7c3a-7b4e-9a1d-3f5e6a7b8c9d";

const h = vi.hoisted(() => ({
  user: null as null | { id: string; role: string },
  baseUrl: "https://alnamer.example" as string | undefined,
  decided: [] as unknown[],
  decideResult: {
    ok: true,
    recipient: { email: "t@example.com", name: "Mona", locale: "ar" },
  } as
    | { ok: true; recipient: { email: string | null; name: string; locale: string | null } }
    | { ok: false; reason: string },
  issued: [] as unknown[],
  issueResult: { ok: true, token: "tok_123", name: "Omar", email: "o@example.com" } as
    | { ok: true; token: string; name: string; email: string }
    | { ok: false; reason: string },
  mails: [] as unknown[][],
  revalidated: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    h.revalidated.push(path);
  },
}));
vi.mock("@/i18n/server", () => ({
  getDictionary: async () => ({ t: en, locale: "en" as const }),
}));
vi.mock("@/server/auth/acting-user", () => ({ getActingUser: async () => h.user }));
vi.mock("@/server/env", () => ({ serverEnv: () => ({ BASE_URL: h.baseUrl }) }));
vi.mock("@/server/auth/form-kit", async () => {
  const fields = (formData: FormData) => Object.fromEntries(formData.entries());
  const echo = (raw: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(raw).filter(([, value]) => typeof value === "string"));
  // Deferred sends run at once so the test sees them.
  const sendAfterResponse = (task: () => Promise<void>) => {
    void task();
  };
  return { fields, echo, sendAfterResponse };
});
vi.mock("./emails", () => ({
  sendTeacherEmail: async (...args: unknown[]) => {
    h.mails.push(args);
  },
}));
vi.mock("./review", () => ({
  decideTeacherApplication: async (input: unknown) => {
    h.decided.push(input);
    return h.decideResult;
  },
}));
vi.mock("./invites", () => ({
  issueTeacherInvite: async (input: unknown) => {
    h.issued.push(input);
    return h.issueResult;
  },
}));

const { decideTeacherAction, inviteTeacherAction } = await import("./admin-actions");

const idle = { status: "idle" as const };

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  h.user = { id: "admin-1", role: "admin" };
  h.baseUrl = "https://alnamer.example";
  h.decided = [];
  h.issued = [];
  h.mails = [];
  h.revalidated = [];
  h.decideResult = {
    ok: true,
    recipient: { email: "t@example.com", name: "Mona", locale: "ar" },
  };
  h.issueResult = { ok: true, token: "tok_123", name: "Omar", email: "o@example.com" };
});

describe("decideTeacherAction", () => {
  it.each([null, { id: "t-1", role: "teacher" }])(
    "sends anyone but an admin away (%o)",
    async (user) => {
      h.user = user;
      await expect(
        decideTeacherAction(idle, form({ teacher_id: TEACHER, decision: "approve" })),
      ).rejects.toThrow("redirect:/dashboard");
      expect(h.decided).toEqual([]);
    },
  );

  it("refuses a malformed submission without calling the service", async () => {
    const state = await decideTeacherAction(
      idle,
      form({ teacher_id: "nope", decision: "approve" }),
    );
    expect(state).toMatchObject({ status: "error", message: en.teachers.admin.error });
    expect(h.decided).toEqual([]);
  });

  it("rejects with the reason, mails it in the teacher's saved locale and reports back", async () => {
    await expect(
      decideTeacherAction(
        idle,
        form({ teacher_id: TEACHER, decision: "reject", reason: "  No certificate  " }),
      ),
    ).rejects.toThrow("redirect:/dashboard/admin/teachers?done=rejected");
    expect(h.decided).toEqual([
      { adminId: "admin-1", teacherId: TEACHER, decision: "reject", reason: "  No certificate  " },
    ]);
    expect(h.mails).toEqual([
      ["t@example.com", "ar", "en", { kind: "rejected", name: "Mona", reason: "No certificate" }],
    ]);
    expect(h.revalidated).toEqual(["/dashboard/admin/teachers"]);
  });

  it("shows a missing reason at the field only", async () => {
    h.decideResult = { ok: false, reason: "reason_required" };
    const state = await decideTeacherAction(
      idle,
      form({ teacher_id: TEACHER, decision: "reject", reason: "" }),
    );
    expect(state).toEqual({
      status: "error",
      message: undefined,
      fieldErrors: { reason: en.teachers.admin.reasonRequired },
      values: { reason: "" },
    });
    expect(h.mails).toEqual([]);
  });

  it("says when the application was already decided", async () => {
    h.decideResult = { ok: false, reason: "not_pending" };
    const state = await decideTeacherAction(
      idle,
      form({ teacher_id: TEACHER, decision: "approve" }),
    );
    expect(state).toMatchObject({ status: "error", message: en.teachers.admin.notPending });
  });
});

describe("inviteTeacherAction", () => {
  it("emails a link built from BASE_URL, never showing the token", async () => {
    const state = await inviteTeacherAction(idle, form({ name: "Omar", email: "o@example.com" }));
    expect(state).toEqual({ status: "success", message: en.teachers.admin.invited });
    expect(JSON.stringify(state)).not.toContain("tok_123");
    expect(h.mails).toEqual([
      [
        "o@example.com",
        null,
        "en",
        { kind: "invite", name: "Omar", link: "https://alnamer.example/teach/invite/tok_123" },
      ],
    ]);
  });

  it("issues nothing without a BASE_URL", async () => {
    h.baseUrl = undefined;
    const state = await inviteTeacherAction(idle, form({ name: "Omar", email: "o@example.com" }));
    expect(state).toMatchObject({ status: "error", message: en.teachers.admin.error });
    expect(h.issued).toEqual([]);
  });

  it.each([
    ["exists", en.teachers.admin.inviteExists],
    ["invalid", en.teachers.admin.inviteInvalid],
    ["rate_limited", en.teachers.admin.inviteLimited],
  ])("maps %s to its message and keeps the fields", async (reason, message) => {
    h.issueResult = { ok: false, reason };
    const state = await inviteTeacherAction(idle, form({ name: "Omar", email: "o@example.com" }));
    expect(state).toMatchObject({
      status: "error",
      message,
      values: { name: "Omar", email: "o@example.com" },
    });
    expect(h.mails).toEqual([]);
  });

  it("sends a non-admin away", async () => {
    h.user = { id: "r-1", role: "reviewer" };
    await expect(
      inviteTeacherAction(idle, form({ name: "Omar", email: "o@example.com" })),
    ).rejects.toThrow("redirect:/dashboard");
    expect(h.issued).toEqual([]);
  });
});
