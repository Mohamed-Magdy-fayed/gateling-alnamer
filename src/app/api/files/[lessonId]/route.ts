import type { NextRequest } from "next/server";
import { getCurrentSession } from "@/server/auth/session";
import { passesTwoFactor } from "@/server/auth/staff-session";
import { clock } from "@/server/clock";
import { serveLessonFile } from "@/server/files/serve";

/** A lesson's PDF, stamped for the signed-in viewer, after the lesson access decision. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ lessonId: string }> },
): Promise<Response> {
  const { lessonId } = await params;
  const session = await getCurrentSession();
  // Staff who have not passed two-factor sign-in act as nobody here (A4 review).
  const viewer = session && passesTwoFactor(session) ? session : null;
  const response = await serveLessonFile(
    viewer ? { id: viewer.user.id, role: viewer.user.role, deviceId: viewer.deviceId } : null,
    lessonId,
    clock.now(),
  );
  return new Response(response.body ? Buffer.from(response.body) : null, {
    status: response.status,
    headers: response.headers,
  });
}
