import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import * as repository from "./repository";

const client = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
const conn = drizzle(client, { schema });

afterAll(async () => {
  await client.end();
});

describe("audit repository", () => {
  it("exports only writeAudit and listAudit", () => {
    expect(Object.keys(repository).sort()).toEqual(["listAudit", "writeAudit"]);
  });

  it("writes redacted before/after and lists newest first", async () => {
    await repository.writeAudit(conn, {
      actorId: null,
      action: "test.first",
      subjectType: "user",
      subjectId: "u1",
      before: { email: "alice@domain.com", password: "secret" },
      after: { iban: "AE070331234567890123456" },
    });
    await repository.writeAudit(conn, {
      actorId: null,
      action: "test.second",
      subjectType: "user",
      subjectId: "u1",
    });

    const rows = await repository.listAudit({ subjectType: "user", subjectId: "u1" }, conn);
    expect(rows.map((r) => r.action)).toEqual(["test.second", "test.first"]);
    expect(rows[1]?.before).toEqual({ email: "a***@d***.com" });
    expect(rows[1]?.after).toEqual({ iban: "3456" });
    expect(rows[0]?.before).toBeNull();
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it("rejects UPDATE and DELETE on audit_log", async () => {
    await repository.writeAudit(conn, {
      actorId: null,
      action: "test.immutable",
      subjectType: "doc",
    });
    await expect(client`update audit_log set action = 'tampered'`).rejects.toThrow(/append-only/);
    await expect(client`delete from audit_log`).rejects.toThrow(/append-only/);
  });

  it("rejects an UPDATE that only nulls actor_id", async () => {
    const [user] = await client`
      insert into users (name, email) values ('B', 'audit-null@example.test') returning id`;
    const actorId = String(user?.id);
    await repository.writeAudit(conn, { actorId, action: "test.null-actor", subjectType: "user" });
    await expect(
      client`update audit_log set actor_id = null where actor_id = ${actorId}`,
    ).rejects.toThrow(/append-only/);
  });

  it("refuses to delete a user who has audit rows", async () => {
    const [user] = await client`
      insert into users (name, email) values ('A', 'audit-actor@example.test') returning id`;
    const actorId = String(user?.id);
    await repository.writeAudit(conn, { actorId, action: "test.actor", subjectType: "user" });
    await expect(client`delete from users where id = ${actorId}`).rejects.toThrow(
      /foreign key|violates/i,
    );
    const rows = await repository.listAudit({ subjectType: "user" }, conn);
    expect(rows.find((r) => r.action === "test.actor")?.actorId).toBe(actorId);
  });
});
