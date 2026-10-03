import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { parseServerEnv } from "./src/server/env-schema";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Sample lesson media is served by a route (signed URLs), never from public/: ship the files with it.
  outputFileTracingIncludes: {
    "/api/media/sample/[assetId]": ["./media/sample/**/*"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

/** Production builds fail fast on an invalid environment (APP_MODE required). */
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) parseServerEnv(process.env);
  return nextConfig;
}
