# Vice Web — Next.js 16 frontend

Client-side super-resolution UI. See root `../README.md` for truth.

```bash
bun install
bun run dev        # predev builds public/vice-worker.js
bun test lib       # unit tests
bun run build      # worker bundle + Next.js build
bun run test:e2e   # Playwright + prod server
```

Deploy: import repo on Vercel, Root Directory `web`. No env vars.
WASM `public/wasm/*` committed (Vercel has no emsdk). Rebuild: `bash ../core/wasm-build.sh` (Emscripten 3.1.74).
