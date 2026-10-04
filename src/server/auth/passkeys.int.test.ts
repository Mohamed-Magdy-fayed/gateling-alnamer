import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import * as schema from "@/server/db/schema";
import { MemoryLimiter } from "../../../test/fake-limiter";

vi.mock("@/server/redis", () => ({ getRedis: () => null }));
vi.mock("@/server/env", () => ({
  serverEnv: () => ({ BASE_URL: "https://alnamer.example", APP_MODE: "demo" }),
}));
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
const pk = await import("./passkeys");
const { randomToken, sha256 } = await import("./password");
const { createUser } = await import("@/server/orders/test-fixtures");

const NOW = new Date("2030-05-01T09:00:00.000Z");
const RP = { rpID: "alnamer.example", origin: "https://alnamer.example" };

beforeEach(() => setClockForTests(NOW));
afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

// Stand-ins for the WebAuthn crypto (the library's own job); these tests cover our rules.
type Verified = { expectedChallenge: unknown };
const registrationOk = (credentialId: string) =>
  vi.fn(async (options: Verified) => ({
    verified: true as const,
    registrationInfo: {
      credential: {
        id: credentialId,
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ["internal"],
      },
      expectedChallenge: options.expectedChallenge,
    },
  }));
const authenticationWith = (newCounter: number, verified = true) =>
  vi.fn(async () => ({ verified, authenticationInfo: { newCounter, credentialID: "x" } }));

async function staffWithSession() {
  const user = await createUser(conn, { role: "admin" });
  const token = randomToken();
  await conn.insert(schema.sessions).values({
    tokenHash: sha256(token),
    userId: user.id,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  });
  return { user, tokenHash: sha256(token) };
}

async function registered(credentialId = `cred-${crypto.randomUUID()}`) {
  const { user, tokenHash } = await staffWithSession();
  const options = await pk.registrationOptions(
    { id: user.id, name: user.name, email: user.email },
    RP,
  );
  expect(options?.challenge).toBeTruthy();
  const result = await pk.finishRegistration(user.id, { id: credentialId } as never, RP, "Laptop", {
    verifyRegistration: registrationOk(credentialId) as never,
  });
  expect(result).toEqual({ ok: true });
  return { user, tokenHash, credentialId };
}

describe("passkeys", () => {
  it("registration stores the credential and consumes its challenge", async () => {
    const { user, credentialId } = await registered();
    const rows = await pk.listPasskeys(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Laptop");
    // The challenge was single use: a second finish has nothing to verify against.
    expect(
      await pk.finishRegistration(user.id, { id: credentialId } as never, RP, null, {
        verifyRegistration: registrationOk(credentialId) as never,
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("a passkey sign-in steps the session up, once per challenge", async () => {
    const { user, tokenHash, credentialId } = await registered();
    const deps = () => ({
      limiter: new MemoryLimiter(),
      key: Buffer.alloc(32, 3),
      verifyAuthentication: authenticationWith(0) as never,
    });
    await pk.authenticationOptions(user.id, RP);
    const result = await pk.verifyPasskeyChallenge(
      user.id,
      tokenHash,
      { id: credentialId } as never,
      RP,
      deps(),
    );
    if (!result.ok) throw new Error(result.reason);
    const [elevated] = await conn
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.tokenHash, sha256(result.rotated.token)));
    expect(elevated?.twoFactorVerified).toBe(true);
    // Replaying the same assertion: the challenge is gone.
    expect(
      await pk.verifyPasskeyChallenge(
        user.id,
        sha256(result.rotated.token),
        { id: credentialId } as never,
        RP,
        deps(),
      ),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses another user's credential, a failed verification and a counter going back", async () => {
    const { user, tokenHash, credentialId } = await registered();
    const other = await registered();
    const deps = (verifyAuthentication: unknown) => ({
      limiter: new MemoryLimiter(),
      key: Buffer.alloc(32, 3),
      verifyAuthentication: verifyAuthentication as never,
    });
    await pk.authenticationOptions(user.id, RP);
    expect(
      await pk.verifyPasskeyChallenge(
        user.id,
        tokenHash,
        { id: other.credentialId } as never,
        RP,
        deps(authenticationWith(1)),
      ),
    ).toEqual({ ok: false, reason: "invalid" });
    await pk.authenticationOptions(user.id, RP);
    expect(
      await pk.verifyPasskeyChallenge(
        user.id,
        tokenHash,
        { id: credentialId } as never,
        RP,
        deps(authenticationWith(1, false)),
      ),
    ).toEqual({ ok: false, reason: "invalid" });
    await conn
      .update(schema.passkeys)
      .set({ counter: 5 })
      .where(eq(schema.passkeys.credentialId, credentialId));
    await pk.authenticationOptions(user.id, RP);
    expect(
      await pk.verifyPasskeyChallenge(
        user.id,
        tokenHash,
        { id: credentialId } as never,
        RP,
        deps(authenticationWith(5)),
      ),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("a user without passkeys gets no options; removal is owner-only", async () => {
    const { user } = await staffWithSession();
    expect(await pk.authenticationOptions(user.id, RP)).toBeNull();
    const owner = await registered();
    const [row] = await pk.listPasskeys(owner.user.id);
    expect(await pk.removePasskey(user.id, row?.id ?? "")).toBe(false);
    expect(await pk.removePasskey(owner.user.id, row?.id ?? "")).toBe(true);
    expect(await pk.listPasskeys(owner.user.id)).toHaveLength(0);
  });
});
