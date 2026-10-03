import { describe, expect, it } from "vitest";
import { type PlaybackClaims, playbackParams, verifyPlayback } from "./sign";

const KEY = Buffer.alloc(32, 9);
const NOW_S = 1_900_000_000;
const claims: PlaybackClaims = {
  assetId: "00000000-0000-7000-8000-000000000901",
  lessonId: "00000000-0000-7000-8000-000000000701",
  userId: "11111111-1111-7111-8111-111111111111",
  deviceId: "22222222-2222-7222-8222-222222222222",
  expiresAtS: NOW_S + 300,
};

function params(overrides: Record<string, string> = {}) {
  const base = Object.fromEntries(playbackParams(KEY, claims));
  return { ...base, ...overrides };
}

describe("playback URL signing", () => {
  it("verifies its own URL and returns the claims", () => {
    expect(verifyPlayback(KEY, claims.assetId, params(), NOW_S)).toEqual(claims);
  });

  it("rejects any tampered field", () => {
    for (const [field, value] of [
      ["l", "00000000-0000-7000-8000-000000000702"],
      ["u", "33333333-3333-7333-8333-333333333333"],
      ["d", "none"],
      ["e", String(NOW_S + 3000)],
    ] as const) {
      expect(verifyPlayback(KEY, claims.assetId, params({ [field]: value }), NOW_S), field).toBe(
        null,
      );
    }
    expect(verifyPlayback(KEY, "00000000-0000-7000-8000-000000000999", params(), NOW_S)).toBeNull();
    expect(verifyPlayback(KEY, claims.assetId, params({ s: "0".repeat(64) }), NOW_S)).toBeNull();
  });

  it("rejects another key", () => {
    expect(verifyPlayback(Buffer.alloc(32, 1), claims.assetId, params(), NOW_S)).toBeNull();
  });

  it("allows 30 s of clock leeway after expiry, then refuses", () => {
    expect(verifyPlayback(KEY, claims.assetId, params(), claims.expiresAtS + 30)).not.toBeNull();
    expect(verifyPlayback(KEY, claims.assetId, params(), claims.expiresAtS + 31)).toBeNull();
  });

  it("encodes an anonymous preview without a user or device", () => {
    const anon = { ...claims, userId: null, deviceId: null };
    const signed = Object.fromEntries(playbackParams(KEY, anon));
    expect(signed.u).toBe("anon");
    expect(signed.d).toBe("none");
    expect(verifyPlayback(KEY, anon.assetId, signed, NOW_S)).toEqual(anon);
  });

  it("rejects malformed input", () => {
    expect(verifyPlayback(KEY, claims.assetId, {}, NOW_S)).toBeNull();
    expect(verifyPlayback(KEY, claims.assetId, params({ e: "soon" }), NOW_S)).toBeNull();
    expect(verifyPlayback(KEY, claims.assetId, params({ s: "short" }), NOW_S)).toBeNull();
  });
});
