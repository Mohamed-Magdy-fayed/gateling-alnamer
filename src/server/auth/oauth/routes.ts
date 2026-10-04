import "server-only";
import type { NextRequest } from "next/server";
import { serverEnv } from "@/server/env";
import { type OAuthProvider, oauthProvider } from "./provider";

export const CALLBACK_PATH = "/api/oauth/google";

/** The configured provider for this deployment, or null (the Google button is hidden). */
export function currentProvider(): OAuthProvider | null {
  const env = serverEnv();
  return oauthProvider({
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    APP_MODE: env.APP_MODE,
    VERCEL: env.VERCEL,
    OAUTH_FORCE_MOCK: env.OAUTH_FORCE_MOCK,
  });
}

/**
 * The redirect URI Google must know: the configured site (BASE_URL), as registered in the Google
 * console. The local mock uses the request's own origin (local ports vary).
 */
export function redirectUriFor(provider: OAuthProvider, request: NextRequest): string {
  const base = serverEnv().BASE_URL;
  const origin = provider.id === "google" && base ? new URL(base).origin : request.nextUrl.origin;
  return `${origin}${CALLBACK_PATH}`;
}
