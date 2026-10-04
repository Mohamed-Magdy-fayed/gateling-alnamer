import type { NextRequest } from "next/server";
import { getCurrentSession } from "@/server/auth/session";
import { passesTwoFactor } from "@/server/auth/staff-session";
import { clock } from "@/server/clock";
import { isSignedForAsset, serveSample } from "@/server/video/serve-sample";

/** Sample video bytes for a signed, short-lived playback URL (see src/server/video). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const { assetId } = await params;
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const nowS = Math.floor(clock.now().getTime() / 1000);
  // A bad or expired URL is refused before any session lookup.
  if (!isSignedForAsset(assetId, query, nowS)) {
    return new Response(null, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }
  // A staff session that has not passed two-factor plays nothing (A8 review L4).
  const current = await getCurrentSession();
  const session = passesTwoFactor(current) ? current : null;
  const response = await serveSample({
    assetId,
    params: query,
    range: request.headers.get("range"),
    viewer: session ? { userId: session.user.id, deviceId: session.deviceId } : null,
    nowS,
  });
  return new Response(response.body, { status: response.status, headers: response.headers });
}
