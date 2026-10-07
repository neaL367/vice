// Emscripten glue is served from public/wasm at runtime (webpackIgnore import
// in lib/engine.ts), so it has no bundled types. Typed loosely on purpose:
// lib/engine.ts narrows with `as` after load.
declare module "*.js";
