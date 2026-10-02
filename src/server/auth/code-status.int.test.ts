import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { users, verificationCodes } from "@/server/db/schema";
import { latestCodeRow } from "./code-status";
import { issueCode } from "./codes";

const client = postgres(process.env.DATABASE_URL ?? "", { max: 2, onnotice: () => {} });
const conn = drizzle(client, { schema });

afterAll(async () => {
  await client.end();
});

async function makeUser(tag: string): Promise<string> {
  const [u] = await conn
    .insert(users)
    .values({ name: "Status", email: `status-${tag}-${Date.now()}@example.test` })
    .returning({ id: users.id });
  if (!u) throw new Error("no user");
  return u.id;
}

describe("latestCodeRow", () => {
  it("is null without a code", async () => {
    expect(await latestCodeRow(await makeUser("none"), "email_verify", conn)).toBeNull();
  });

  it("returns the newest unconsumed code's email status and creation time", async () => {
    const userId = await makeUser("some");
    const { codeId } = await issueCode(userId, "email_verify", conn);
    const queued = await latestCodeRow(userId, "email_verify", conn);
    expect(queued?.emailStatus).toBe("queued");
    await conn
      .update(verificationCodes)
      .set({ emailStatus: "failed" })
      .where(eq(verificationCodes.id, codeId));
    expect((await latestCodeRow(userId, "email_verify", conn))?.emailStatus).toBe("failed");
    expect(await latestCodeRow(userId, "password_reset", conn)).toBeNull();
  });

  it("ignores consumed codes", async () => {
    const userId = await makeUser("used");
    const { codeId } = await issueCode(userId, "email_verify", conn);
    await conn
      .update(verificationCodes)
      .set({ consumedAt: new Date() })
      .where(eq(verificationCodes.id, codeId));
    expect(await latestCodeRow(userId, "email_verify", conn)).toBeNull();
  });
});
