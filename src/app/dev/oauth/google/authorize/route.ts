import { notFound, redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { mockCode } from "@/server/auth/oauth/provider";
import { CALLBACK_PATH, currentProvider } from "@/server/auth/oauth/routes";
import { assertDevRoute } from "@/server/dev-guard";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The mock provider's "sign in" (a plain GET form, so the browser follows one 302 back to the
 * callback, as with Google): returns the chosen test identity as a sealed code bound to the flow's
 * PKCE challenge. Demo mode off Vercel only, and only back to a local /api/oauth/google.
 */
export async function GET(request: NextRequest): Promise<never> {
  assertDevRoute();
  if (currentProvider()?.id !== "mock") notFound();
  const params = request.nextUrl.searchParams;
  const text = (key: string) => (params.get(key) ?? "").trim();
  let target: URL;
  try {
    target = new URL(text("redirect_uri"));
  } catch {
    notFound();
  }
  if (target.pathname !== CALLBACK_PATH || !LOCAL_HOSTS.has(target.hostname)) notFound();
  const email = text("email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 120) notFound();
  const code = mockCode(
    {
      subject: `mock-${email}`,
      email,
      emailVerified: text("verified") === "on",
      name: text("name").slice(0, 80) || email,
    },
    text("code_challenge"),
  );
  target.search = new URLSearchParams({ state: text("state"), code }).toString();
  redirect(target.toString());
}
