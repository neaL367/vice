import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated worker bundle (bun build output, not source):
    "public/vice-worker.js",
    "public/slab-worker.js",
    // Generated Emscripten glue (wasm-build output, not source):
    "public/wasm/**",
  ]),
]);

export default eslintConfig;
