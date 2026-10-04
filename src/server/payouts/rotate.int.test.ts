import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";

vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const dbSchema = await import("@/server/db/schema");
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 4, onnotice: () => {} });
  const conn = drizzle(client, { schema: dbSchema });
  return { db: () => conn, closeTestDb: () => client.end() };
});

const dbModule = (await import("@/server/db")) as unknown as {
  db: () => import("@/server/orders/test-fixtures").TestConn;
  closeTestDb: () => Promise<void>;
};
const conn = dbModule.db();
const { rotateIbanKeys } = await import("./rotate");
const { ibanKeyring, openIban, sealIban } = await import("./payout-crypto");
const { createUser } = await import("@/server/orders/test-fixtures");

afterAll(() => dbModule.closeTestDb());

const key = (fill: number) => Buffer.alloc(32, fill).toString("base64");
const OLD = ibanKeyring({ IBAN_ENCRYPTION_KEY: key(21) });
const ROTATING = ibanKeyring({
  IBAN_ENCRYPTION_KEY: key(22),
  IBAN_KEY_VERSION: "2",
  IBAN_ENCRYPTION_KEY_PREVIOUS: key(21),
});
const NEW_ONLY = ibanKeyring({ IBAN_ENCRYPTION_KEY: key(22), IBAN_KEY_VERSION: "2" });
const IBAN = "AE070331234567890123456";

async function teacherWithDetails(ring = OLD) {
  const user = await createUser(conn, { role: "teacher" });
  await conn.insert(schema.teacherProfiles).values({
    userId: user.id,
    publicName: { en: "Teacher" },
    bio: { en: "Bio" },
    status: "approved",
  });
  const sealed = sealIban(ring, user.id, IBAN);
  await conn.insert(schema.teacherPayoutDetails).values({
    userId: user.id,
    ibanCiphertext: sealed.ciphertext,
    ibanLast4: "3456",
    ibanCountry: "AE",
    holderName: "Holder",
    bankName: "Bank",
    keyVersion: sealed.keyVersion,
  });
  return user.id;
}

async function rowsOf(ids: string[]) {
  return conn
    .select()
    .from(schema.teacherPayoutDetails)
    .where(inArray(schema.teacherPayoutDetails.userId, ids));
}

describe("rotateIbanKeys", () => {
  it("re-seals previous-version rows under the new key; a rerun changes nothing", async () => {
    const ids = [await teacherWithDetails(), await teacherWithDetails()];
    const first = await rotateIbanKeys(conn, ROTATING, 1);
    expect(first.rotated).toBeGreaterThanOrEqual(2);
    for (const row of await rowsOf(ids)) {
      expect(row.keyVersion).toBe(2);
      expect(
        openIban(NEW_ONLY, row.userId, { ciphertext: row.ibanCiphertext, keyVersion: 2 }),
      ).toBe(IBAN);
    }
    const before = await rowsOf(ids);
    await rotateIbanKeys(conn, ROTATING, 1);
    expect(await rowsOf(ids)).toEqual(before);

    const audit = await conn
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "payout_details.keys_rotated"));
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(audit)).not.toContain(IBAN);
  });

  it("leaves a row it cannot open and reports it", async () => {
    const stray = ibanKeyring({ IBAN_ENCRYPTION_KEY: key(23) });
    const id = await teacherWithDetails(stray);
    const result = await rotateIbanKeys(conn, ROTATING, 5);
    expect(result.unreadable).toBeGreaterThanOrEqual(1);
    expect(result.remaining).toBeGreaterThanOrEqual(1);
    const [row] = await rowsOf([id]);
    expect(row?.keyVersion).toBe(1);
  });

  it("does nothing without a previous key", async () => {
    await expect(rotateIbanKeys(conn, NEW_ONLY)).rejects.toThrow(/IBAN_ENCRYPTION_KEY_PREVIOUS/);
  });
});
