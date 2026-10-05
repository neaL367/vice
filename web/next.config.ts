import type { NextConfig } from "next";

// React dev needs eval() for callstack reconstruction; never in production.
// Docs: app/guides/content-security-policy (development vs production).
const isDev = process.env.NODE_ENV === "development";

// Static CSP (no nonces): nonce-based CSP forces dynamic rendering and is
// incompatible with Partial Prerendering, so this app uses the static recipe
// from app/guides/content-security-policy. wasm-unsafe-eval covers the
// Emscripten core; everything else is same-origin.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // No cross-origin isolation: slab workers are plain Workers with
  // per-worker WASM instances (no SharedArrayBuffer, no COOP/COEP). Same-
  // origin assets only; third-party embeds no longer need CORP headers.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      },
    ];
  },
};

export default nextConfig;
