import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { parseServerEnv } from "./src/server/env-schema";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Sample lesson media is served by a route (signed URLs), never from public/: ship the files with it.
  outputFileTracingIncludes: {
    "/api/media/sample/[assetId]": ["./media/sample/**/*"],
    "/api/files/[lessonId]": ["./media/sample/**/*"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), usb=(), browsing-topics=()",
          },
          // Browsers ignore HSTS over plain http, so local runs are unaffected. No preload.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
      {
        // API responses are JSON or bytes, never pages: nothing may run or frame them. Pages get a
        // per-request nonce CSP from src/proxy.ts instead.
        source: "/api/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" },
        ],
      },
      {
        // Lesson PDFs are shown in an iframe on our own learn page; everything else stays DENY.
        // CSP sandbox stays off too: Chrome refuses to render a PDF in a sandboxed document.
        source: "/api/files/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Only frame-ancestors: object-src 'none' (from default-src) can stop Chrome's PDF viewer.
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
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
