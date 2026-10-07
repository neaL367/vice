import type { NextConfig } from "next";

// cacheComponents: true IS partial prerendering in Next 16 (experimental.ppr
// removed): static shell prerenders, dynamic workspace streams in. Single-thread
// WASM core, one instance per worker: no COOP/COEP needed.
const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // automatic memoization (Rust in-process build, no Babel pass).
  reactCompiler: true,
  experimental: {
    turbopackRustReactCompiler: true,
    // reclaim stale compile work during long dev sessions (dev-only).
    turbopackGc: true,
    // compile client dynamic imports on first request, not up front.
    turbopackLazyDynamicImports: true,
    // plugin tools in-process via worker threads (falls back to child
    // processes on Node >= 24.13.1 per nodejs/node#65100 — harmless either way).
    turbopackPluginRuntimeStrategy: "workerThreads",
    // nudge (dev/build) when a security upgrade applies. "latest"
    // would also chase minors — noise for a pinned deterministic toolchain.
    agentUpgrade: "security",
  },
};

export default nextConfig;
