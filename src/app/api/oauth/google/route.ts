import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { guardOAuthCallback } from "@/server/auth/abuse";
import { completeSignIn } from "@/server/auth/complete-sign-in";
import { setPendingCookie, takeFlowCookie } from "@/server/auth/oauth/cookies";
import { resolveOAuthSignIn } from "@/server/auth/oauth/decide";
import { statesMatch } from "@/server/auth/oauth/flow";
import { currentProvider, redirectUriFor } from "@/server/auth/oauth/routes";
import { requestContext } from "@/server/auth/request-context";

const MAX_PARAM = 2048;

/**
 * Google's redirect back: the state must match the sealed flow cookie (taken, so it works once),
 * the code is exchanged with the PKCE verifier, then the identity decides: sign in, link and sign
 * in, finish a new sign-up, or a notice on the sign-in page.
 */
export async function GET(request: NextRequest): Promise<never> {
  const provider = currentProvider();
  if (!provider) redirect("/sign-in");
  const device = await requestContext();
  const guard = await guardOAuthCallback({ ip: device.ip });
  if (!("ok" in guard)) redirect("/sign-in?notice=google-failed");

  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";
  const flow = await takeFlowCookie();
  if (
    !flow ||
    !code ||
    code.length > MAX_PARAM ||
    state.length > MAX_PARAM ||
    !statesMatch(flow.state, state)
  ) {
    redirect("/sign-in?notice=google-failed");
  }

  const identity = await provider
    .exchange({ code, codeVerifier: flow.verifier, redirectUri: redirectUriFor(provider, request) })
    .catch(() => null);
  if (!identity) redirect("/sign-in?notice=google-failed");

  const decision = await resolveOAuthSignIn(identity);
  switch (decision.kind) {
    case "signin":
      return completeSignIn(decision.userId, device, flow.next);
    case "new":
      await setPendingCookie(identity, flow.next, request.nextUrl.protocol === "https:");
      redirect("/sign-up/google");
      break;
    case "needs_password":
      redirect("/sign-in?notice=google-password");
      break;
    case "refused":
      redirect("/sign-in?notice=google-failed");
  }
  redirect("/sign-in?notice=google-failed");
}
