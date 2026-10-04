import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, vi } from "vitest";
import { deriveKey } from "@/server/auth/keys";
import { setClockForTests } from "@/server/clock";
import * as dbModule from "@/server/db";
import { auditLog, parentLinks, users } from "@/server/db/schema";
import { MemoryLimiter } from "../../../test/fake-limiter";
import * as svc from "./service";

// Shared by the parents service int tests. Each test file mocks @/server/db (a real test
// connection) before importing this module, then calls registerParentTestHooks().

export const NOW = new Date("2030-03-01T09:00:00.000Z");
export const DAY = 24 * 60 * 60 * 1000;
export const ctx = { locale: "en" as const };
export const sendCode = vi.fn(async (..._args: unknown[]) => {});

let limiter = new MemoryLimiter();
export const deps = () => ({ limiter, key: deriveKey("t".repeat(40), "rl"), sendCode });

export const db = () => dbModule.db();

/** Pins the clock, gives every test a fresh limiter and closes the connection at the end. */
export function registerParentTestHooks(): void {
  afterAll(() => (dbModule as unknown as { closeTestDb: () => Promise<void> }).closeTestDb());
  beforeEach(() => {
    setClockForTests(NOW);
    limiter = new MemoryLimiter();
    sendCode.mockClear();
  });
}

let seq = 0;
export async function makeUser(
  role: "student" | "parent" | "admin",
  over: Partial<typeof users.$inferInsert> = {},
) {
  seq += 1;
  const [user] = await db()
    .insert(users)
    .values({
      name: `${role} ${seq}`,
      email: `${role}${seq}-${crypto.randomUUID()}@example.test`,
      role,
      emailVerifiedAt: NOW,
      dateOfBirth: role === "parent" ? "1985-01-01" : "2015-01-01",
      ...over,
    })
    .returning({ id: users.id });
  if (!user) throw new Error("no user");
  return user.id;
}

export async function link(
  parentId: string,
  studentId: string,
  source: "invite" | "created_child",
) {
  await db().insert(parentLinks).values({ parentId, studentId, source });
}

export async function auditFor(action: string, subjectId: string) {
  return db()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, action), eq(auditLog.subjectId, subjectId)));
}

export function childInput(over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    name: "Little One",
    username: `little_${seq}_${Math.random().toString(36).slice(2, 7)}`,
    password: "A-good-pass-1",
    date_of_birth: "2016-05-05",
    ...over,
  };
}

export async function createOk(parentId: string, over: Record<string, unknown> = {}) {
  const result = await svc.createChild(parentId, childInput(over), ctx, deps());
  if (!result.ok) throw new Error(`createChild failed: ${result.code}`);
  return result.childId;
}

export async function issueOk(parentId: string) {
  const issued = await svc.issueInvite(parentId);
  if (!issued.ok) throw new Error(`issue failed: ${issued.code}`);
  return issued;
}
