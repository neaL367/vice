import type { NextConfig } from "next";

// cacheComponents: true IS partial prerendering in Next 16 (experimental.ppr
// removed): static shell prerenders, dynamic workspace streams in. Single-thread
// WASM core, one instance per worker: no COOP/COEP needed.
const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
