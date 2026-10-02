import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { guardChildCreate, guardInviteRedeem } from "@/server/auth/abuse";
import { deriveKey } from "@/server/auth/keys";
import { setClockForTests } from "@/server/clock";
import { MemoryLimiter } from "../../../test/fake-limiter";

const T0 = new Date("2030-01-01T10:00:00.000Z");
const key = deriveKey("t".repeat(40), "rl");
let limiter: MemoryLimiter;
const deps = () => ({ limiter, key });

beforeEach(() => {
  setClockForTests(T0);
  limiter = new MemoryLimiter();
});
afterEach(() => setClockForTests(null));

describe("guardInviteRedeem", () => {
  it("allows 5 attempts in 15 minutes per student and rate-limits the 6th", async () => {
    for (let i = 0; i < 5; i += 1) {
      expect(await guardInviteRedeem({ studentId: "s1", ip: `10.0.0.${i}` }, deps())).toEqual({
        ok: true,
      });
    }
    const sixth = await guardInviteRedeem({ studentId: "s1", ip: "10.0.0.9" }, deps());
    expect(sixth).toMatchObject({ blocked: "rateLimited" });
    setClockForTests(new Date(T0.getTime() + 15 * 60 * 1000 + 1000));
    expect(await guardInviteRedeem({ studentId: "s1", ip: "10.0.0.9" }, deps())).toEqual({
      ok: true,
    });
  });

  it("allows 20 per hour per IP across students and blocks the 21st", async () => {
    for (let i = 0; i < 20; i += 1) {
      expect(await guardInviteRedeem({ studentId: `s${i}`, ip: "10.1.1.1" }, deps())).toEqual({
        ok: true,
      });
    }
    expect(await guardInviteRedeem({ studentId: "s99", ip: "10.1.1.1" }, deps())).toMatchObject({
      blocked: "rateLimited",
    });
  });

  it("never puts a raw student id or IP in a limiter key", async () => {
    await guardInviteRedeem({ studentId: "student-raw-id", ip: "203.0.113.7" }, deps());
    for (const k of limiter.keys) {
      expect(k).not.toContain("student-raw-id");
      expect(k).not.toContain("203.0.113.7");
    }
  });
});

describe("guardChildCreate", () => {
  it("allows 10 a day per parent and blocks the 11th", async () => {
    for (let i = 0; i < 10; i += 1) {
      expect(await guardChildCreate({ parentId: "p1" }, deps())).toEqual({ ok: true });
    }
    expect(await guardChildCreate({ parentId: "p1" }, deps())).toMatchObject({
      blocked: "rateLimited",
    });
    expect(await guardChildCreate({ parentId: "p2" }, deps())).toEqual({ ok: true });
  });
});
