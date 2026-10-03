import type { NextRequest } from "next/server";
import { getCurrentSession } from "@/server/auth/session";
import { clock } from "@/server/clock";
import { serveLessonFile } from "@/server/files/serve";

/** A lesson's PDF, stamped for the signed-in viewer, after the lesson access decision. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ lessonId: string }> },
): Promise<Response> {
  const { lessonId } = await params;
  const session = await getCurrentSession();
  const response = await serveLessonFile(
    session ? { id: session.user.id, role: session.user.role, deviceId: session.deviceId } : null,
    lessonId,
    clock.now(),
  );
  return new Response(response.body ? Buffer.from(response.body) : null, {
    status: response.status,
    headers: response.headers,
  });
}
