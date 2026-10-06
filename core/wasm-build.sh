#!/bin/bash
# WASM build: single-thread guarded-loop core for slab workers.
# Requires emsdk on PATH (run D:/emsdk/emsdk_env.sh first or set EMSDK).
# Output: web/public/wasm/core.{js,wasm} (committed so deploys work w/o emsdk).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/web/public/wasm"
mkdir -p "$OUT"
emcc -O3 -std=c++20 \
  -I "$ROOT/core/include" \
  "$ROOT/core/src/kernels.cpp" \
  "$ROOT/core/src/forward.cpp" \
  "$ROOT/core/src/ibp.cpp" \
  "$ROOT/core/src/color.cpp" \
  "$ROOT/core/src/api.cpp" \
  "$ROOT/tools/wasm/entry.cpp" \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORTED_RUNTIME_METHODS='["HEAPU8"]' \
  -s EXPORTED_FUNCTIONS='["_vice_abi_version","_vice_upscale","_vice_last_residual","_vice_build_info","_malloc","_free"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=67108864 \
  -s ASSERTIONS=0 \
  -o "$OUT/core.js"
ls -la "$OUT"
