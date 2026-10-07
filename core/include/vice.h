#pragma once
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Vice deterministic reconstruction engine (C++ port of research/ref).
 * Pipeline per channel (float64): lanczos3 init → 4× guarded IBP passes
 * (bilinear residual upsample, clamp to [minLR,maxLR], exact box projection).
 * Product v1 processes gamma bytes per channel; linear-light path is future
 * work (constants already mirror research in color.cpp).
 * All functions are thread-unsafe w.r.t. the residual slot; one render per
 * thread at a time (workers use separate threads, never shared calls).
 */

#define VICE_ABI_VERSION 2u
#define VICE_ITERS 4

unsigned vice_abi_version(void);

/* Upscale w×h×ch bytes (ch = 1, 3, or 4) by scale (2, 3, 4) into out
 * (caller allocates w*scale*h*scale*ch bytes). Returns 0 on success,
 * -1 on bad arguments. Output is rounded to bytes (product path).
 * Scale 4 runs hierarchical 2→4 staging internally (Stage-4 adoption). */
int vice_upscale(const unsigned char* in, int w, int h, int ch, int scale, unsigned char* out);

/* Hierarchical progressive upscale by scale (2, 4, 8): float64 staging
 * through 2x steps, every stage projecting against the input; integer-exact
 * block quantization applies once at the final scale. Same return contract. */
int vice_upscale_progressive(const unsigned char* in, int w, int h, int ch, int scale,
                             unsigned char* out);

/* RMS forward residual ‖DHx−y‖ of the last vice_upscale call, in levels. */
double vice_last_residual(void);

#ifdef __cplusplus
}
#endif
