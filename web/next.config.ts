import type { NextConfig } from "next";

// React dev needs eval() for callstack reconstruction; never in production.
// Docs: app/guides/content-security-policy (development vs production).
const isDev = process.env.NODE_ENV === "development";

// Static CSP (no nonces): nonce-based CSP forces dynamic rendering and is
// incompatible with Partial Prerendering, so this app uses the static recipe
// from app/guides/content-security-policy. wasm-unsafe-eval covers the
// Emscripten core + ONNX Runtime; everything else is same-origin.
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
  // Cross-origin isolation: enables SharedArrayBuffer for multi-threaded
  // ORT WASM (JSEP build) inside the worker. Same-origin assets only, so
  // require-corp is safe here. Re-verify prefetch + navigation after change.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
