import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import {
  auditLog,
  deviceRemovals,
  devices,
  platformSettings,
  sessions,
  users,
} from "@/server/db/schema";

vi.mock("@/server/redis", () => ({ getRedis: () => null }));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("@/server/db/schema");
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 6, onnotice: () => {} });
  const conn = drizzle(client, { schema });
  return { db: () => conn, closeTestDb: () => client.end() };
});

const dbModule = (await import("@/server/db")) as unknown as {
  db: () => ReturnType<typeof import("drizzle-orm/postgres-js").drizzle>;
  closeTestDb: () => Promise<void>;
};
const service = await import("./service");

const db = () =>
  dbModule.db() as unknown as import("drizzle-orm/postgres-js").PostgresJsDatabase<
    typeof import("@/server/db/schema")
  >;

const NOW = new Date("2030-03-01T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36";
const key = () => crypto.randomUUID();

async function makeUser(label: string, role: "student" | "admin" | "parent" = "student") {
  const [user] = await db()
    .insert(users)
    .values({
      name: label,
      email: `${label}-${crypto.randomUUID()}@example.test`,
      role,
      emailVerifiedAt: NOW,
    })
    .returning({ id: users.id });
  if (!user) throw new Error("no user");
  return user.id;
}

async function setSettings(limit: number, mode: "strict" | "soft") {
  await db()
    .update(platformSettings)
    .set({ deviceLimit: limit, deviceLimitMode: mode })
    .where(eq(platformSettings.id, 1));
}

async function addSession(userId: string, deviceId: string | null) {
  const tokenHash = crypto.randomUUID();
  await db()
    .insert(sessions)
    .values({ tokenHash, userId, deviceId, expiresAt: new Date(NOW.getTime() + DAY) });
  return tokenHash;
}

async function deviceRows(userId: string) {
  return db().select().from(devices).where(eq(devices.userId, userId));
}

async function sessionRows(tokenHash: string) {
  return db().select().from(sessions).where(eq(sessions.tokenHash, tokenHash));
}

async function need(userId: string, deviceKey: string) {
  const result = await service.registerOrBlock(userId, deviceKey, UA);
  if (!result.deviceId) throw new Error(`expected a device, got ${result.outcome}`);
  return result.deviceId;
}

beforeEach(async () => {
  setClockForTests(NOW);
  await setSettings(2, "strict");
});

afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

describe("registerOrBlock", () => {
  it("registers under the limit, knows a returning key, blocks over the limit", async () => {
    const userId = await makeUser("reg");
    const k1 = key();
    const first = await service.registerOrBlock(userId, k1, UA);
    expect(first.outcome).toBe("register");
    expect(first.deviceId).toBeTruthy();
    const again = await service.registerOrBlock(userId, k1, UA);
    expect(again).toMatchObject({ outcome: "known", deviceId: first.deviceId });
    expect((await service.registerOrBlock(userId, key(), UA)).outcome).toBe("register");
    const blocked = await service.registerOrBlock(userId, key(), UA);
    expect(blocked).toMatchObject({ outcome: "block", deviceId: null });
    expect(await deviceRows(userId)).toHaveLength(2);

    const audit = await db().select().from(auditLog).where(eq(auditLog.actorId, userId));
    expect(audit.map((a) => [a.action, a.after])).toEqual([
      ["device.limit_exceeded", { mode: "strict", count: 2 }],
    ]);
    const [row] = await deviceRows(userId);
    expect(row?.label).toBe("Chrome on Windows");
  });

  it("soft mode registers over the limit and audits it", async () => {
    await setSettings(1, "soft");
    const userId = await makeUser("soft");
    await service.registerOrBlock(userId, key(), UA);
    const over = await service.registerOrBlock(userId, key(), UA);
    expect(over.outcome).toBe("registerOver");
    expect(over.deviceId).toBeTruthy();
    expect(await deviceRows(userId)).toHaveLength(2);
    const audit = await db().select().from(auditLog).where(eq(auditLog.actorId, userId));
    expect(audit[0]?.after).toEqual({ mode: "soft", count: 1 });
  });

  it("two parallel calls for the last slot register exactly one", async () => {
    const userId = await makeUser("race");
    await service.registerOrBlock(userId, key(), UA);
    const results = await Promise.all([
      service.registerOrBlock(userId, key(), UA),
      service.registerOrBlock(userId, key(), UA),
    ]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["block", "register"]);
    expect(await deviceRows(userId)).toHaveLength(2);
  });
});

describe("touchDevice", () => {
  it("writes last_seen_at at most every 5 minutes", async () => {
    const userId = await makeUser("touch");
    const deviceId = await need(userId, key());
    const tokenHash = await addSession(userId, deviceId);

    setClockForTests(new Date(NOW.getTime() + 2 * 60 * 1000));
    expect(await service.touchDevice(deviceId, tokenHash)).toBe(false);
    const later = new Date(NOW.getTime() + 6 * 60 * 1000);
    setClockForTests(later);
    expect(await service.touchDevice(deviceId, tokenHash)).toBe(true);

    const [device] = await db().select().from(devices).where(eq(devices.id, deviceId));
    expect(device?.lastSeenAt.getTime()).toBe(later.getTime());
    const [session] = await sessionRows(tokenHash);
    expect(session?.lastSeenAt?.getTime()).toBe(later.getTime());
  });
});

describe("touchDevice without a session", () => {
  it("is one plain UPDATE: no transaction", async () => {
    const userId = await makeUser("touch1");
    const deviceId = await need(userId, key());
    setClockForTests(new Date(NOW.getTime() + 6 * 60 * 1000));
    const spy = vi.spyOn(db(), "transaction");
    expect(await service.touchDevice(deviceId)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    const [device] = await db().select().from(devices).where(eq(devices.id, deviceId));
    expect(device?.lastSeenAt.getTime()).toBe(NOW.getTime() + 6 * 60 * 1000);
  });
});

describe("assertActiveDevice", () => {
  it("passes non-students, needs a device for students, rejects revoked devices", async () => {
    expect(await service.assertActiveDevice({ role: "teacher", deviceId: null })).toEqual({
      ok: true,
    });
    expect(await service.assertActiveDevice({ role: "student", deviceId: null })).toEqual({
      ok: false,
      reason: "needs_check",
    });
    const userId = await makeUser("assert");
    const deviceId = await need(userId, key());
    expect(await service.assertActiveDevice({ role: "student", deviceId })).toEqual({ ok: true });
    await db()
      .update(devices)
      .set({ revokedAt: NOW, revokedReason: "self" })
      .where(eq(devices.id, deviceId));
    expect(await service.assertActiveDevice({ role: "student", deviceId })).toEqual({
      ok: false,
      reason: "device_inactive",
    });
  });
});

describe("removeDevice", () => {
  it("self removal revokes, deletes that device's sessions only, records it, then throttles", async () => {
    const userId = await makeUser("rm");
    const kCurrent = key();
    const a = await need(userId, key());
    const b = await need(userId, kCurrent);
    const sa = await addSession(userId, a);
    const sb = await addSession(userId, b);

    expect(await service.removeDevice({ userId, deviceId: b, currentDeviceKey: kCurrent })).toEqual(
      { ok: false, reason: "is_current" },
    );

    expect(await service.removeDevice({ userId, deviceId: a, currentDeviceKey: kCurrent })).toEqual(
      { ok: true },
    );
    const [dev] = await db().select().from(devices).where(eq(devices.id, a));
    expect(dev).toMatchObject({ revokedReason: "self" });
    expect(dev?.revokedAt).toBeTruthy();
    expect(await sessionRows(sa)).toHaveLength(0);
    expect(await sessionRows(sb)).toHaveLength(1);
    const rem = await db().select().from(deviceRemovals).where(eq(deviceRemovals.userId, userId));
    expect(rem).toMatchObject([{ kind: "self", actorId: userId, deviceId: a }]);

    // the freed slot can be taken, then a second removal inside 7 days is throttled
    const c = await need(userId, key());
    const next = await service.nextSelfRemovalAt(userId);
    expect(next?.getTime()).toBe(NOW.getTime() + 7 * DAY);
    expect(await service.removeDevice({ userId, deviceId: c, currentDeviceKey: kCurrent })).toEqual(
      { ok: false, reason: "throttled", nextAt: new Date(NOW.getTime() + 7 * DAY) },
    );

    setClockForTests(new Date(NOW.getTime() + 7 * DAY));
    expect(await service.nextSelfRemovalAt(userId)).toBeNull();
    expect(
      (await service.removeDevice({ userId, deviceId: c, currentDeviceKey: kCurrent })).ok,
    ).toBe(true);
  });

  it("refuses another user's device", async () => {
    const owner = await makeUser("own");
    const other = await makeUser("oth");
    const d = await need(owner, key());
    expect(
      await service.removeDevice({ userId: other, deviceId: d, currentDeviceKey: key() }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("removeAndRegister", () => {
  it("revokes, records the removal and registers the current device in one go", async () => {
    const userId = await makeUser("rar");
    await setSettings(1, "strict");
    const old = await need(userId, key());
    const so = await addSession(userId, old);
    const current = key();

    const result = await service.removeAndRegister({
      userId,
      deviceId: old,
      currentDeviceKey: current,
      userAgent: UA,
    });
    expect(result).toMatchObject({ ok: true, deviceId: expect.any(String) });
    const [revoked] = await db().select().from(devices).where(eq(devices.id, old));
    expect(revoked).toMatchObject({ revokedReason: "self" });
    expect(await sessionRows(so)).toHaveLength(0);
    const active = (await deviceRows(userId)).filter((d) => d.revokedAt === null);
    expect(active.map((d) => d.deviceKey)).toEqual([current]);
    const rem = await db().select().from(deviceRemovals).where(eq(deviceRemovals.userId, userId));
    expect(rem).toMatchObject([{ kind: "self", deviceId: old }]);
  });

  it("commits nothing, and spends no throttle, when the current device would still be blocked", async () => {
    const userId = await makeUser("rarb");
    await setSettings(2, "strict");
    const a = await need(userId, key());
    await need(userId, key());
    await setSettings(1, "strict"); // lowered: one removal leaves one active, still at the limit
    const sa = await addSession(userId, a);

    const result = await service.removeAndRegister({
      userId,
      deviceId: a,
      currentDeviceKey: key(),
      userAgent: UA,
    });
    expect(result).toEqual({ ok: false, reason: "blocked" });
    expect((await deviceRows(userId)).filter((d) => d.revokedAt === null)).toHaveLength(2);
    expect(await sessionRows(sa)).toHaveLength(1);
    expect(
      await db().select().from(deviceRemovals).where(eq(deviceRemovals.userId, userId)),
    ).toHaveLength(0);
    expect(await service.nextSelfRemovalAt(userId)).toBeNull();
  });

  it("keeps the throttle, the current-device and the ownership rules", async () => {
    const userId = await makeUser("rarr");
    const other = await makeUser("rarro");
    const kCurrent = key();
    const a = await need(userId, key());
    const b = await need(userId, kCurrent);
    const mine = { userId, currentDeviceKey: kCurrent, userAgent: UA };
    expect(await service.removeAndRegister({ ...mine, deviceId: b })).toEqual({
      ok: false,
      reason: "is_current",
    });
    expect(await service.removeAndRegister({ ...mine, userId: other, deviceId: a })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect((await service.removeAndRegister({ ...mine, deviceId: a })).ok).toBe(true);
    const c = await need(userId, key());
    expect(await service.removeAndRegister({ ...mine, deviceId: c })).toEqual({
      ok: false,
      reason: "throttled",
      nextAt: new Date(NOW.getTime() + 7 * DAY),
    });
  });
});

describe("expireDevices", () => {
  it("revokes only devices idle over 30 days, deletes their sessions and frees the slot", async () => {
    const userId = await makeUser("exp");
    const old = await need(userId, key());
    const fresh = await need(userId, key());
    await db()
      .update(devices)
      .set({ lastSeenAt: new Date(NOW.getTime() - 31 * DAY) })
      .where(eq(devices.id, old));
    const so = await addSession(userId, old);
    const sf = await addSession(userId, fresh);

    const ids = await service.expireDevices();
    expect(ids).toContain(old);
    expect(ids).not.toContain(fresh);
    const [dev] = await db().select().from(devices).where(eq(devices.id, old));
    expect(dev?.revokedReason).toBe("expired");
    expect(await sessionRows(so)).toHaveLength(0);
    expect(await sessionRows(sf)).toHaveLength(1);
    expect((await service.registerOrBlock(userId, key(), UA)).outcome).toBe("register");
  });
});

describe("resetDevices", () => {
  it("revokes all, deletes sessions, writes admin removals and the audit row with the actor", async () => {
    const admin = await makeUser("adm", "admin");
    const userId = await makeUser("rst");
    const a = await need(userId, key());
    await need(userId, key());
    const sa = await addSession(userId, a);

    expect(await service.resetDevices(userId, admin)).toBe(2);
    const rows = await deviceRows(userId);
    expect(rows.every((d) => d.revokedReason === "admin" && d.revokedAt)).toBe(true);
    expect(await sessionRows(sa)).toHaveLength(0);
    const rem = await db()
      .select()
      .from(deviceRemovals)
      .where(and(eq(deviceRemovals.userId, userId), eq(deviceRemovals.kind, "admin")));
    expect(rem).toHaveLength(2);
    expect(rem.every((r) => r.actorId === admin)).toBe(true);
    const audit = await db().select().from(auditLog).where(eq(auditLog.action, "device.reset"));
    expect(audit.filter((x) => x.actorId === admin && x.subjectId === userId)).toHaveLength(1);
    // an admin reset never throttles the student's own removals
    expect(await service.nextSelfRemovalAt(userId)).toBeNull();
    expect((await service.registerOrBlock(userId, key(), UA)).outcome).toBe("register");
  });
});

describe("supportRecipients", () => {
  it("returns verified admin emails", async () => {
    const admin = await makeUser("sup", "admin");
    const student = await makeUser("sstu");
    const [row] = await db().select({ email: users.email }).from(users).where(eq(users.id, admin));
    expect(await service.supportRecipients(student)).toContain(row?.email);
  });
});

describe("listActiveDevices", () => {
  it("lists only active devices, most recently used first", async () => {
    const userId = await makeUser("list");
    await setSettings(5, "strict");
    const old = (await service.registerOrBlock(userId, key(), UA)).deviceId;
    const recent = (await service.registerOrBlock(userId, key(), null)).deviceId;
    const gone = (await service.registerOrBlock(userId, key(), UA)).deviceId;
    await db()
      .update(devices)
      .set({ lastSeenAt: new Date(NOW.getTime() - DAY) })
      .where(eq(devices.id, old as string));
    await db()
      .update(devices)
      .set({ revokedAt: NOW, revokedReason: "self" })
      .where(eq(devices.id, gone as string));
    const list = await service.listActiveDevices(userId);
    expect(list.map((d) => d.id)).toEqual([recent, old]);
    expect(list[0]?.label).toBeNull();
    expect(list[1]?.label).toBe("Chrome on Windows");
  });
});

describe("supportContacts", () => {
  it("returns verified admins with their saved locale", async () => {
    const admin = await makeUser("supc", "admin");
    await db().update(users).set({ locale: "en" }).where(eq(users.id, admin));
    const student = await makeUser("supcs");
    const [row] = await db().select({ email: users.email }).from(users).where(eq(users.id, admin));
    const contacts = await service.supportContacts(student);
    expect(contacts).toContainEqual({ email: row?.email, locale: "en" });
  });
});
