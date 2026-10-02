import { describe, expect, it } from "vitest";
import { CODE_RESEND_COOLDOWN_MS } from "@/server/config/policy";
import { describeCodeStatus } from "./code-status";

const NOW = new Date("2026-10-02T10:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("describeCodeStatus (email verification)", () => {
  it("reports the row's status and lets resend open one cooldown after it was created", () => {
    const row = { emailStatus: "sent" as const, createdAt: ago(10_000) };
    expect(describeCodeStatus({ purpose: "email_verify", row, now: NOW })).toEqual({
      status: "sent",
      canResendAt: row.createdAt.getTime() + CODE_RESEND_COOLDOWN_MS,
    });
  });

  it("passes queued and failed through", () => {
    for (const emailStatus of ["queued", "failed"] as const) {
      const row = { emailStatus, createdAt: ago(5_000) };
      expect(describeCodeStatus({ purpose: "email_verify", row, now: NOW }).status).toBe(
        emailStatus,
      );
    }
  });

  it("allows an immediate resend when no code exists", () => {
    expect(describeCodeStatus({ purpose: "email_verify", row: null, now: NOW })).toEqual({
      status: "sent",
      canResendAt: 0,
    });
  });
});

describe("describeCodeStatus (password reset)", () => {
  const issuedAt = ago(5_000).getTime();

  it("answers an unknown account (no row) as sent, with the cooldown from the cookie", () => {
    expect(
      describeCodeStatus({ purpose: "password_reset", row: null, issuedAt, now: NOW }),
    ).toEqual({ status: "sent", canResendAt: issuedAt + CODE_RESEND_COOLDOWN_MS });
  });

  it("hides a still-fresh queued send, so it looks like the unknown-account answer", () => {
    const row = { emailStatus: "queued" as const, createdAt: ago(5_000) };
    expect(describeCodeStatus({ purpose: "password_reset", row, issuedAt, now: NOW }).status).toBe(
      "sent",
    );
  });

  it("reports queued once it has been stuck for a full cooldown, and failed at once", () => {
    const old = ago(CODE_RESEND_COOLDOWN_MS + 1).getTime();
    const stuck = { emailStatus: "queued" as const, createdAt: new Date(old) };
    expect(
      describeCodeStatus({ purpose: "password_reset", row: stuck, issuedAt: old, now: NOW }).status,
    ).toBe("queued");
    const failed = { emailStatus: "failed" as const, createdAt: ago(1_000) };
    expect(
      describeCodeStatus({ purpose: "password_reset", row: failed, issuedAt, now: NOW }).status,
    ).toBe("failed");
  });
});
