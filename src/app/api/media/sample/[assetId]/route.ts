import type { NextRequest } from "next/server";
import { getCurrentSession } from "@/server/auth/session";
import { clock } from "@/server/clock";
import { serveSample } from "@/server/video/serve-sample";

/** Sample video bytes for a signed, short-lived playback URL (see src/server/video). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const { assetId } = await params;
  const session = await getCurrentSession();
  const response = await serveSample({
    assetId,
    params: Object.fromEntries(request.nextUrl.searchParams),
    range: request.headers.get("range"),
    viewer: session ? { userId: session.user.id, deviceId: session.deviceId } : null,
    nowS: Math.floor(clock.now().getTime() / 1000),
  });
  return new Response(response.body, { status: response.status, headers: response.headers });
}
