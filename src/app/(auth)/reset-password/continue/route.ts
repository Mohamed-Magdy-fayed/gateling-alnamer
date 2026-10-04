import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { adoptPendingReset } from "@/server/auth/pending-reset";

const MAX_TOKEN = 1024;

/**
 * The reset email's link: adopts its signed reset context in this browser, so the code can be
 * entered on whichever device opened the mail. A bad or expired link goes back to "forgot".
 */
export async function GET(request: NextRequest): Promise<never> {
  const token = request.nextUrl.searchParams.get("t") ?? "";
  const adopted = token.length > 0 && token.length <= MAX_TOKEN && (await adoptPendingReset(token));
  redirect(adopted ? "/reset-password" : "/forgot-password");
}
