import "server-only";
import { authKey } from "../keys";
import { open, seal } from "../secret-box";
import { codeChallenge } from "./flow";

/** What the app needs from Google's account: a stable id, the email and whether Google verified it. */
export type OAuthIdentity = {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

export interface OAuthProvider {
  readonly id: "google" | "mock";
  authorizeUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchange(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<OAuthIdentity | null>;
}

const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
const TIMEOUT_MS = 8000;

/** Google: authorization code + PKCE; the identity comes from the userinfo endpoint over TLS. */
export function googleProvider(clientId: string, clientSecret: string): OAuthProvider {
  return {
    id: "google",
    authorizeUrl({ state, codeChallenge, redirectUri }) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      });
      return `${GOOGLE_AUTHORIZE}?${params.toString()}`;
    },
    async exchange({ code, codeVerifier, redirectUri }) {
      const token = await fetch(GOOGLE_TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: codeVerifier,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!token.ok) return null;
      const { access_token: accessToken } = (await token.json()) as { access_token?: unknown };
      if (typeof accessToken !== "string") return null;
      const info = await fetch(GOOGLE_USERINFO, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!info.ok) return null;
      const data = (await info.json()) as Record<string, unknown>;
      if (typeof data.sub !== "string" || typeof data.email !== "string") return null;
      return {
        subject: data.sub,
        email: data.email,
        emailVerified: data.email_verified === true,
        name: typeof data.name === "string" ? data.name : "",
      };
    },
  };
}

export const MOCK_AUTHORIZE_PATH = "/dev/oauth/google";

/**
 * The local stand-in (tests and local runs only, never deployed): the hosted page picks a test
 * identity and returns it as a sealed code bound to the PKCE challenge, so the callback path and
 * the PKCE check are exercised exactly as with Google.
 */
export function mockProvider(key: Buffer = authKey("oauth")): OAuthProvider {
  return {
    id: "mock",
    authorizeUrl({ state, codeChallenge, redirectUri }) {
      const params = new URLSearchParams({
        state,
        code_challenge: codeChallenge,
        redirect_uri: redirectUri,
      });
      return `${MOCK_AUTHORIZE_PATH}?${params.toString()}`;
    },
    async exchange({ code, codeVerifier }) {
      const plain = open(key, code);
      if (!plain) return null;
      try {
        const data = JSON.parse(plain) as OAuthIdentity & { challenge: string; t?: unknown };
        if (data.t !== "mock" || data.challenge !== codeChallenge(codeVerifier)) return null;
        return {
          subject: data.subject,
          email: data.email,
          emailVerified: data.emailVerified,
          name: data.name,
        };
      } catch {
        return null;
      }
    },
  };
}

/** The mock's hosted page: the code for a chosen identity, bound to the flow's PKCE challenge. */
export function mockCode(
  identity: OAuthIdentity,
  challenge: string,
  key: Buffer = authKey("oauth"),
): string {
  return seal(key, JSON.stringify({ t: "mock", ...identity, challenge }));
}

/**
 * The provider for this deployment: Google with both keys set; the local mock only by explicit
 * opt-in (see above); otherwise none, and the button is hidden.
 */
export function oauthProvider(env: {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APP_MODE?: string;
  VERCEL?: string;
  OAUTH_FORCE_MOCK?: string;
}): OAuthProvider | null {
  // The mock is opt-in (OAUTH_FORCE_MOCK=1, set by the smoke run), demo mode, never on Vercel; its
  // routes also refuse any request that is not to localhost. env-schema refuses the flag in live.
  if (env.OAUTH_FORCE_MOCK === "1" && env.APP_MODE === "demo" && !env.VERCEL) {
    return mockProvider();
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return googleProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  }
  return null;
}
