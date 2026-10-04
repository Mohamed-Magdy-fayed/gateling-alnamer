import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { setFlowCookie } from "@/server/auth/oauth/cookies";
import { codeChallenge, newFlow } from "@/server/auth/oauth/flow";
import { currentProvider, redirectUriFor } from "@/server/auth/oauth/routes";
import { requestContext } from "@/server/auth/request-context";
import { safeNextPath } from "@/server/devices/next-path";

/** Starts Google sign-in: a fresh state and PKCE verifier in a sealed cookie, then the provider. */
export async function GET(request: NextRequest): Promise<never> {
  const provider = currentProvider();
  if (!provider) redirect("/sign-in");
  const flow = newFlow(
    safeNextPath(request.nextUrl.searchParams.get("next")),
    Math.floor(Date.now() / 1000),
  );
  // Secure follows the proxy-aware request context, like the session cookie.
  await setFlowCookie(flow, (await requestContext()).secure);
  redirect(
    provider.authorizeUrl({
      state: flow.state,
      codeChallenge: codeChallenge(flow.verifier),
      redirectUri: redirectUriFor(provider, request),
    }),
  );
}
