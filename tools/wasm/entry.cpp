// WASM entry point: links the vice static core with Emscripten exports.
// The JS glue (MODULARIZE+ES6, see core/wasm-build.sh) exposes:
//   _vice_abi_version, _vice_upscale, _vice_last_residual, _malloc, _free.
// Buffers cross the boundary as WASM-heap pointers; the worker owns layout.
#include "vice.h"

#ifdef __cplusplus
extern "C" {
#endif

// Version string for the UI/about surface (informational only, not a contract).
const char* vice_build_info(void) { return "vice-wasm guarded-loop ref port"; }

#ifdef __cplusplus
}
#endif
