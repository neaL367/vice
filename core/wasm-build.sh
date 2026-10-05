#!/usr/bin/env bash
# WASM build for the Vice C++ core. Pinned toolchain: Emscripten 3.1.74.
# Install: D:/emsdk/emsdk install 3.1.74 && D:/emsdk/emsdk activate 3.1.74
# Run from repo root: bash core/wasm-build.sh
set -euo pipefail

EMSDK="${EMSDK:-D:/emsdk}"
export EMSDK_PYTHON="${EMSDK_PYTHON:-$EMSDK/python/3.13.3_64bit/python.exe}"
# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" > /dev/null

OUT="web/public/wasm"
mkdir -p "$OUT"

emcc -O3 -msimd128 -flto -fno-exceptions -fno-rtti \
  -x c++ -std=c++20 \
  -Icore/include \
  core/src/color.cpp core/src/project.cpp \
  core/src/png_filters.cpp core/src/png_writer.cpp core/src/png.cpp \
  core/src/stream_renderer.cpp core/src/fused_4x.cpp \
  core/src/parallel_runtime.cpp core/src/upscale.cpp core/src/miniz.c core/src/miniz_tdef.c \
  core/src/miniz_tinfl.c tools/wasm/entry.cpp \
  -o "$OUT/core.js" \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createViceCore \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=67108864 \
  -sMAXIMUM_MEMORY=2147483648 \
  -sENVIRONMENT=web,worker,node \
  -sEXPORTED_FUNCTIONS=_vice_stream_create,_vice_stream_set_icc_profile,_vice_stream_push_input_rows,_vice_stream_has_next_band,_vice_stream_pull_band,_vice_stream_finish_png,_vice_stream_last_residual,_vice_stream_set_fused,_vice_stream_destroy,_vice_png_open,_vice_png_write_rows,_vice_png_drain,_vice_png_close,_vice_png_destroy,_vice_png_peak_pending,_vice_thread_workers,_vice_srgb_to_linear,_vice_linear_to_srgb,_vice_fast_linear_to_srgb,_vice_fast_srgb_to_linear,_vice_spatial_triangular_dither,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=HEAPF32,HEAPU8

ls -la "$OUT/core.js" "$OUT/core.wasm"

# Threaded variant: identical source + VICE_THREADS row sharding.
# Loads only in cross-origin-isolated pages (COOP/COEP headers ship app-wide);
# the loader falls back to core.js otherwise. Not used by the node/bun tests.
emcc -O3 -msimd128 -flto -fno-exceptions -fno-rtti -pthread -DVICE_THREADS \
  -x c++ -std=c++20 \
  -Icore/include \
  core/src/color.cpp core/src/project.cpp \
  core/src/png_filters.cpp core/src/png_writer.cpp core/src/png.cpp \
  core/src/stream_renderer.cpp core/src/fused_4x.cpp \
  core/src/parallel_runtime.cpp core/src/upscale.cpp core/src/miniz.c core/src/miniz_tdef.c \
  core/src/miniz_tinfl.c tools/wasm/entry.cpp \
  -o "$OUT/core.threaded.js" \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createViceCore \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=67108864 \
  -sMAXIMUM_MEMORY=2147483648 \
  -sENVIRONMENT=web,worker \
  -sPTHREAD_POOL_SIZE=4 \
  -sEXPORTED_FUNCTIONS=_vice_stream_create,_vice_stream_set_icc_profile,_vice_stream_push_input_rows,_vice_stream_has_next_band,_vice_stream_pull_band,_vice_stream_finish_png,_vice_stream_last_residual,_vice_stream_set_fused,_vice_stream_destroy,_vice_png_open,_vice_png_write_rows,_vice_png_drain,_vice_png_close,_vice_png_destroy,_vice_png_peak_pending,_vice_thread_workers,_vice_srgb_to_linear,_vice_linear_to_srgb,_vice_fast_linear_to_srgb,_vice_fast_srgb_to_linear,_vice_spatial_triangular_dither,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=HEAPF32,HEAPU8

ls -la "$OUT/core.threaded.js" "$OUT/core.threaded.wasm"
