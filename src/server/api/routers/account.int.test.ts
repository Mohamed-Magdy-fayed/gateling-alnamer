import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import { credentials, devices, sessions, users, verificationCodes } from "@/server/db/schema";

const sent = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; data: Record<string, unknown> }>,
}));

vi.mock("@/server/redis", () => ({ getRedis: () => null }));
vi.mock("@/server/jobs/send", () => ({
  sendEvent: vi.fn(async (name: string, data: Record<string, unknown>) => {
    sent.calls.push({ name, data });
  }),
}));
vi.mock("@/server/auth/session", async () => {
  const core = await import("@/server/auth/session-invalidate");
  return {
    getCurrentSession: vi.fn(async () => null),
    invalidateUserSessions: core.invalidateUserSessionsCore,
  };
});
vi.mock("@/server/auth/request-context", () => ({
  requestContext: vi.fn(async () => ({
    ip: "9.9.9.9",
    deviceId: null,
    deviceKey: "00000000-0000-4000-8000-0000000000aa",
    userAgent: null,
    secure: true,
  })),
}));
vi.mock("@/i18n/server", () => ({ getLocale: vi.fn(async () => "en") }));
vi.mock("@/server/env", () => ({
  serverEnv: () => ({ BASE_URL: "https://alnamer.example" }),
}));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("@/server/db/schema");
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 4, onnotice: () => {} });
  const conn = drizzle(client, { schema });
  return { db: () => conn, closeTestDb: () => client.end() };
});

const dbModule = (await import("@/server/db")) as unknown as {
  db: () => ReturnType<typeof import("drizzle-orm/postgres-js").drizzle>;
  closeTestDb: () => Promise<void>;
};
const { appRouter } = await import("../root");
const { createCallerFactory } = await import("../trpc");
const { hashPassword, verifyPassword } = await import("@/server/auth/password");
const { verifyCode } = await import("@/server/auth/codes");
const db = () =>
  dbModule.db() as unknown as import("drizzle-orm/postgres-js").PostgresJsDatabase<
    typeof import("@/server/db/schema")
  >;

const NOW = new Date("2030-05-01T09:00:00.000Z");
const HEADERS = new Headers({ origin: "https://alnamer.example", host: "alnamer.example" });
const PASSWORD = "current-password-1";
const DEVICE_KEY = "00000000-0000-4000-8000-0000000000aa";

type Role = "student" | "parent";
type TestUser = { id: string; name: string; email: string | null; role: Role; status: "active" };

async function makeUser(role: Role = "student", withEmail = true): Promise<TestUser> {
  const [user] = await db()
    .insert(users)
    .values({
      name: `${role} user`,
      email: withEmail ? `${role}-${crypto.randomUUID()}@example.test` : null,
      username: withEmail ? null : `u_${crypto.randomUUID().slice(0, 8)}`,
      role,
      emailVerifiedAt: withEmail ? NOW : null,
      dateOfBirth: role === "parent" ? "1985-01-01" : "2015-01-01",
    })
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
    });
  if (!user) throw new Error("no user");
  await db()
    .insert(credentials)
    .values({ userId: user.id, passwordHash: await hashPassword(PASSWORD) });
  return user as TestUser;
}

async function makeSession(userId: string, deviceId: string | null = null): Promise<string> {
  const tokenHash = `hash-${crypto.randomUUID()}`;
  await db()
    .insert(sessions)
    .values({ tokenHash, userId, deviceId, expiresAt: new Date(NOW.getTime() + 86_400_000) });
  return tokenHash;
}

async function makeDevice(userId: string, key: string = crypto.randomUUID(), label = "Chrome") {
  const [device] = await db()
    .insert(devices)
    .values({ userId, deviceKey: key, label })
    .returning({ id: devices.id });
  if (!device) throw new Error("no device");
  return device.id;
}

type CallerOptions = { tokenHash?: string; deviceId?: string | null };
const as = (user: TestUser, options: CallerOptions = {}) =>
  createCallerFactory(appRouter)({
    user,
    headers: HEADERS,
    sessionTokenHash: options.tokenHash,
    sessionDeviceId: options.deviceId ?? null,
  });

async function rowsFor(userId: string) {
  return db().select().from(sessions).where(eq(sessions.userId, userId));
}

beforeEach(() => {
  setClockForTests(NOW);
  sent.calls.length = 0;
});
afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

describe("account.updateProfile", () => {
  it("saves the name and language and leaves other fields alone", async () => {
    const user = await makeUser();
    await expect(
      as(user).account.updateProfile({ name: "  Nour Ali  ", locale: "en" }),
    ).resolves.toEqual({ saved: true });
    const [row] = await db().select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({ name: "Nour Ali", locale: "en", role: "student" });
  });

  it("rejects an unknown language and an empty name", async () => {
    const user = await makeUser();
    await expect(
      as(user).account.updateProfile({ name: "Nour", locale: "fr" as "en" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(as(user).account.updateProfile({ name: " ", locale: "ar" })).rejects.toMatchObject(
      { code: "BAD_REQUEST" },
    );
  });

  it("is refused without sign-in and without an Origin header", async () => {
    const user = await makeUser();
    const anonymous = createCallerFactory(appRouter)({ user: null, headers: HEADERS });
    await expect(
      anonymous.account.updateProfile({ name: "Nour", locale: "ar" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const noOrigin = createCallerFactory(appRouter)({ user, headers: new Headers() });
    await expect(
      noOrigin.account.updateProfile({ name: "Nour", locale: "ar" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("account.changePassword", () => {
  it("a wrong current password fails and the password stays", async () => {
    const user = await makeUser();
    await expect(
      as(user).account.changePassword({ current: "not-the-password", next: "brand-new-pass-2" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [cred] = await db().select().from(credentials).where(eq(credentials.userId, user.id));
    expect(await verifyPassword(PASSWORD, cred as never)).toBe(true);
  });

  it("is limited per user: after ten wrong tries even the right password is refused", async () => {
    const user = await makeUser();
    for (let i = 0; i < 10; i += 1) {
      await expect(
        as(user).account.changePassword({ current: "wrong-wrong-1", next: "brand-new-pass-2" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(
      as(user).account.changePassword({ current: PASSWORD, next: "brand-new-pass-2" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("success writes argon2id, signs out other sessions and keeps the current one", async () => {
    const user = await makeUser();
    const current = await makeSession(user.id);
    const other = await makeSession(user.id);
    await expect(
      as(user, { tokenHash: current }).account.changePassword({
        current: PASSWORD,
        next: "brand-new-pass-2",
      }),
    ).resolves.toEqual({ changed: true });

    const [cred] = await db().select().from(credentials).where(eq(credentials.userId, user.id));
    expect(cred?.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword("brand-new-pass-2", cred as never)).toBe(true);
    expect(await verifyPassword(PASSWORD, cred as never)).toBe(false);
    const left = (await rowsFor(user.id)).map((row) => row.tokenHash);
    expect(left).toEqual([current]);
    expect(left).not.toContain(other);
  });

  it("rejects a next password that is too short", async () => {
    const user = await makeUser();
    await expect(
      as(user).account.changePassword({ current: PASSWORD, next: "short" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("account.listSessions and revokeSession", () => {
  it("lists only own sessions with a pinned shape and no token hashes", async () => {
    const user = await makeUser("parent");
    const stranger = await makeUser();
    const deviceId = await makeDevice(user.id, DEVICE_KEY, "Firefox on Windows");
    const current = await makeSession(user.id, deviceId);
    await makeSession(user.id);
    await makeSession(stranger.id);

    const listed = await as(user, { tokenHash: current }).account.listSessions();
    expect(listed).toHaveLength(2);
    for (const item of listed) {
      expect(Object.keys(item).sort()).toEqual([
        "createdAt",
        "current",
        "deviceLabel",
        "id",
        "lastSeenAt",
      ]);
    }
    expect(listed.filter((item) => item.current)).toHaveLength(1);
    expect(listed.find((item) => item.current)?.deviceLabel).toBeNull();
    expect(JSON.stringify(listed)).not.toContain("hash-");
  });

  it("shows the device label for a student's session only", async () => {
    const student = await makeUser("student");
    const deviceId = await makeDevice(student.id, crypto.randomUUID(), "Safari on iOS");
    const token = await makeSession(student.id, deviceId);
    const listed = await as(student, { tokenHash: token }).account.listSessions();
    expect(listed[0]?.deviceLabel).toBe("Safari on iOS");

    const parent = await makeUser("parent");
    const parentDevice = await makeDevice(parent.id, crypto.randomUUID(), "Chrome on Windows");
    const parentToken = await makeSession(parent.id, parentDevice);
    const parentList = await as(parent, { tokenHash: parentToken }).account.listSessions();
    expect(parentList[0]?.deviceLabel).toBeNull();
  });

  it("revokes an own other session", async () => {
    const user = await makeUser();
    const current = await makeSession(user.id);
    const other = await makeSession(user.id);
    const otherId = (await rowsFor(user.id)).find((row) => row.tokenHash === other)?.id ?? "";
    await expect(
      as(user, { tokenHash: current }).account.revokeSession({ id: otherId }),
    ).resolves.toEqual({ revoked: true });
    expect((await rowsFor(user.id)).map((row) => row.tokenHash)).toEqual([current]);
  });

  it("cannot revoke the current session or another user's session", async () => {
    const user = await makeUser();
    const stranger = await makeUser();
    const current = await makeSession(user.id);
    const theirs = await makeSession(stranger.id);
    const currentId = (await rowsFor(user.id))[0]?.id ?? "";
    const theirId = (await rowsFor(stranger.id)).find((r) => r.tokenHash === theirs)?.id ?? "";

    await expect(
      as(user, { tokenHash: current }).account.revokeSession({ id: currentId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      as(user, { tokenHash: current }).account.revokeSession({ id: theirId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await rowsFor(user.id)).toHaveLength(1);
    expect(await rowsFor(stranger.id)).toHaveLength(1);
  });
});

describe("account.addEmail and verifyAddedEmail", () => {
  const codeOf = () => String(sent.calls.at(-1)?.data.code);

  it("stores the address as pending on the code row, never on the user, until verified", async () => {
    const child = await makeUser("student", false);
    const address = `new-${crypto.randomUUID()}@example.test`;
    await expect(as(child).account.addEmail({ email: address })).resolves.toEqual({
      codeSent: true,
    });
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0]?.data).toMatchObject({ to: address, purpose: "email_verify" });

    const [row] = await db().select().from(users).where(eq(users.id, child.id));
    expect(row?.email).toBeNull();
    expect(row?.emailVerifiedAt).toBeNull();
    const [code] = await db()
      .select()
      .from(verificationCodes)
      .where(eq(verificationCodes.userId, child.id));
    expect(code?.pendingEmail).toBe(address);
  });

  it("answers codeSent for a taken address but sends nothing and stores nothing", async () => {
    const taken = await makeUser("parent");
    const child = await makeUser("student", false);
    await expect(
      as(child).account.addEmail({ email: (taken.email ?? "").toUpperCase() }),
    ).resolves.toEqual({ codeSent: true });
    expect(sent.calls).toHaveLength(0);
    const codes = await db()
      .select()
      .from(verificationCodes)
      .where(eq(verificationCodes.userId, child.id));
    expect(codes).toHaveLength(0);
  });

  it("is only for users without an email", async () => {
    const user = await makeUser("parent");
    await expect(
      as(user).account.addEmail({ email: `x-${crypto.randomUUID()}@example.test` }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(sent.calls).toHaveLength(0);
  });

  it("the right code sets email and email_verified_at together", async () => {
    const child = await makeUser("student", false);
    const address = `ok-${crypto.randomUUID()}@example.test`;
    await as(child).account.addEmail({ email: address });
    await expect(as(child).account.verifyAddedEmail({ code: codeOf() })).resolves.toEqual({
      verified: true,
    });
    const [row] = await db().select().from(users).where(eq(users.id, child.id));
    expect(row?.email).toBe(address);
    expect(row?.emailVerifiedAt).toEqual(NOW);
  });

  it("a wrong code is invalid and changes nothing", async () => {
    const child = await makeUser("student", false);
    await as(child).account.addEmail({ email: `w-${crypto.randomUUID()}@example.test` });
    const wrong = codeOf() === "000000" ? "111111" : "000000";
    await expect(as(child).account.verifyAddedEmail({ code: wrong })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const [row] = await db().select().from(users).where(eq(users.id, child.id));
    expect(row?.email).toBeNull();
  });

  it("fails safely when the address became taken meanwhile", async () => {
    const child = await makeUser("student", false);
    const address = `race-${crypto.randomUUID()}@example.test`;
    await as(child).account.addEmail({ email: address });
    const code = codeOf();
    await db()
      .insert(users)
      .values({ name: "Taker", email: address, role: "parent", dateOfBirth: "1985-01-01" });
    await expect(as(child).account.verifyAddedEmail({ code })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const [row] = await db().select().from(users).where(eq(users.id, child.id));
    expect(row?.email).toBeNull();
    expect(row?.emailVerifiedAt).toBeNull();
  });

  it("a pending code never verifies through the ordinary email verify path", async () => {
    const child = await makeUser("student", false);
    await as(child).account.addEmail({ email: `p-${crypto.randomUUID()}@example.test` });
    const result = await verifyCode(child.id, "email_verify", codeOf(), db());
    expect(result).toEqual({ ok: false, reason: "invalid" });
    const [row] = await db().select().from(users).where(eq(users.id, child.id));
    expect(row?.email).toBeNull();
    expect(row?.emailVerifiedAt).toBeNull();
  });

  it("limits code sends per account", async () => {
    const child = await makeUser("student", false);
    for (let i = 0; i < 3; i += 1) {
      await as(child).account.addEmail({ email: `l${i}-${crypto.randomUUID()}@example.test` });
    }
    await expect(
      as(child).account.addEmail({ email: `l9-${crypto.randomUUID()}@example.test` }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("account.listDevices and removeDevice", () => {
  it("lists a student's active devices and marks the current one", async () => {
    const student = await makeUser("student");
    const currentId = await makeDevice(student.id, DEVICE_KEY, "Chrome on Windows");
    await makeDevice(student.id, crypto.randomUUID(), "Safari on iOS");
    const out = await as(student, { deviceId: currentId }).account.listDevices();
    expect(out.devices).toHaveLength(2);
    expect(out.devices.filter((d) => d.current).map((d) => d.id)).toEqual([currentId]);
    expect(out.nextRemovalAt).toBeNull();
    expect(Object.keys(out.devices[0] ?? {}).sort()).toEqual([
      "current",
      "id",
      "label",
      "lastSeenAt",
    ]);
  });

  it("is for students only", async () => {
    const parent = await makeUser("parent");
    await expect(as(parent).account.listDevices()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      as(parent).account.removeDevice({ deviceId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("removes another device, refuses the current one, then throttles", async () => {
    const student = await makeUser("student");
    const currentId = await makeDevice(student.id, DEVICE_KEY, "Chrome on Windows");
    const second = await makeDevice(student.id);
    const third = await makeDevice(student.id);
    const caller = as(student, { deviceId: currentId });

    await expect(caller.account.removeDevice({ deviceId: currentId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.account.removeDevice({ deviceId: second })).resolves.toEqual({
      removed: true,
    });
    const [gone] = await db()
      .select()
      .from(devices)
      .where(and(eq(devices.id, second), eq(devices.userId, student.id)));
    expect(gone?.revokedAt).not.toBeNull();
    await expect(caller.account.removeDevice({ deviceId: third })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    const out = await caller.account.listDevices();
    expect(out.nextRemovalAt).not.toBeNull();
  });

  it("cannot remove another user's device", async () => {
    const student = await makeUser("student");
    const stranger = await makeUser("student");
    const theirs = await makeDevice(stranger.id);
    await expect(as(student).account.removeDevice({ deviceId: theirs })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
