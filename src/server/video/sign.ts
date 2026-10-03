import { createHmac, timingSafeEqual } from "node:crypto";
import { VIDEO_TOKEN_LEEWAY_S } from "@/server/config/policy";

/**
 * What a playback URL is bound to: the asset, the lesson whose access decision issued it, the viewer
 * (null for an anonymous free preview), the viewer's device, and an expiry in Unix seconds.
 */
export type PlaybackClaims = {
  assetId: string;
  lessonId: string;
  userId: string | null;
  deviceId: string | null;
  expiresAtS: number;
};

const ANON = "anon";
const NO_DEVICE = "none";
const SIGNATURE = /^[0-9a-f]{64}$/;
const ID = /^[0-9a-f-]{36}$/i;

function canonical(claims: PlaybackClaims): string {
  return [
    "v1",
    claims.assetId,
    claims.lessonId,
    claims.userId ?? ANON,
    claims.deviceId ?? NO_DEVICE,
    String(claims.expiresAtS),
  ].join("|");
}

function sign(key: Buffer, claims: PlaybackClaims): string {
  return createHmac("sha256", key).update(canonical(claims)).digest("hex");
}

/** Query parameters of a signed playback URL (the asset id is in the path). */
export function playbackParams(key: Buffer, claims: PlaybackClaims): URLSearchParams {
  return new URLSearchParams({
    l: claims.lessonId,
    u: claims.userId ?? ANON,
    d: claims.deviceId ?? NO_DEVICE,
    e: String(claims.expiresAtS),
    s: sign(key, claims),
  });
}

/** The claims of a valid, unexpired URL (30 s leeway), or null. Constant-time signature check. */
export function verifyPlayback(
  key: Buffer,
  assetId: string,
  params: Readonly<Record<string, string | undefined>>,
  nowS: number,
): PlaybackClaims | null {
  const { l, u, d, e, s } = params;
  if (!l || !u || !d || !e || !s || !SIGNATURE.test(s) || !/^\d{1,12}$/.test(e)) return null;
  if (!ID.test(assetId) || !ID.test(l)) return null;
  const claims: PlaybackClaims = {
    assetId,
    lessonId: l,
    userId: u === ANON ? null : u,
    deviceId: d === NO_DEVICE ? null : d,
    expiresAtS: Number(e),
  };
  const expected = Buffer.from(sign(key, claims), "hex");
  const given = Buffer.from(s, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (nowS > claims.expiresAtS + VIDEO_TOKEN_LEEWAY_S) return null;
  return claims;
}
