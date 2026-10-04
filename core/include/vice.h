#pragma once
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct vice_ctx vice_ctx;

/* Create context. in_w/in_h = input dims, scale = 2/3/4, channels = 3 or 4.
   Returns NULL on invalid args / overflow. */
vice_ctx* vice_create(int in_w, int in_h, int scale, int channels);

/* Set full-res input y (h*w*C linear-light premultiplied float, range [0,1]).
   Must be called once before submit. Copies data. Returns 0 ok, <0 error. */
int vice_set_input(vice_ctx* ctx, const float* y, int n);

/* Submit one raw network tile. Tile is already blended into band space by caller?
   v1: tx,ty = top-left in output pixels, tile = th*tw*C floats, n = th*tw*C.
   Accumulates with overwrite (caller blends overlaps before submit, or submits
   disjoint tiles). Returns 0 ok. */
int vice_submit_raw_tile(vice_ctx* ctx, int tx, int ty, const float* tile,
                         int tw, int th, int n);

/* Project accumulated raw buffer with box consistency vs input y.
   Runs project->clamp up to 3 rounds. Returns 0 ok. */
int vice_project(vice_ctx* ctx);

/* Download the projected float buffer (out_w*out_h*channels floats).
   Exists for chaining passes without re-upload; n must match exactly. */
int vice_download_raw(vice_ctx* ctx, float* out, int n);

/* Copy finished output scanlines for band (band of output rows).
   out_rows must hold band_h*out_w*C bytes. Sets *out_row_count.
   Quantizes float->8bit sRGB inside. Returns 0 ok. */
int vice_process_band(vice_ctx* ctx, int band, unsigned char* out_rows,
                      int* out_row_count);

/* Encode full output to PNG (8-bit, pass-through, filter None, stored deflate).
   v1 valid but uncompressed; swap to miniz/zlib-ng later. */
int vice_finish_png(vice_ctx* ctx, unsigned char* out, size_t cap,
                    size_t* written);

/* Attach an ICC profile to be embedded as an iCCP chunk in the output PNG. */
int vice_set_icc_profile(vice_ctx* ctx, const unsigned char* data, size_t size);

/* L-inf residual ||A(out)-y|| after last project (float domain). */
double vice_last_residual(const vice_ctx* ctx);

void vice_destroy(vice_ctx* ctx);

/* Native Lanczos-3 adaptive super-resolution upscaler on context.
   Upscales ctx->y directly into ctx->raw with diagonal steering and noise-gated acutance. */
int vice_upscale(vice_ctx* ctx);

/* Native Lanczos-3 adaptive upscaler on context with explicit tuning parameters. */
int vice_upscale_ex(vice_ctx* ctx, const struct ViceTuning* tuning);

/* Pure helpers exposed for tests and standalone native pipelines. */
int vice_upscale_lanczos_adaptive(const float* src, int w, int h, int c, int scale, float* dst);

/* Heuristic constants of the adaptive engine. vice_tuning_defaults() returns the
   shipped values; vice_upscale_lanczos_adaptive() is exactly the _ex variant with
   those defaults. */
typedef struct ViceTuning {
  float noise_floor;  /* edge energy below which no acutance boost is applied */
  float boost;        /* max acutance boost strength */
  float boost_slope;  /* ramp of the boost above the noise floor */
  float wide_weight;  /* weight of the 4-tap span in edge energy */
  float steer_thresh; /* diagonal asymmetry needed to steer */
  float steer_weight; /* max blend toward the diagonal average */
  float dering;       /* anti-ringing clamp strength [0.0, 1.0] (default 1.0) */
  float sharpness;    /* null-space high-pass sharpness boost [0.0, 1.0] (default 0.35) */
  int   preset;       /* 0 = adaptive lanczos (photo), 1 = smooth (CGI), 2 = pixel art */
  float shock;        /* coherence shock PDE strength [0.0, 1.0] (default 0.35 photo, 0 else) */
} ViceTuning;
void vice_tuning_defaults(ViceTuning* t);
int vice_upscale_lanczos_adaptive_ex(const float* src, int w, int h, int c, int scale, float* dst,
                                     const ViceTuning* tuning);
void vice_project_box(const float* y, float* raw, int w, int h, int s, int c);
/* Clamp-aware exact box projection: shifts each s*s block by a per-block scalar d
   such that mean(clamp(v + d, 0, 1)) = y, guaranteeing both [0, 1] range and
   residual <= 3e-8 even on saturated content. */
void vice_project_box_clamped(const float* y, float* raw, int w, int h, int s, int c);
/* Iterative back-projection with a bilinear correction (no block seams). Approximate;
   follow with vice_project_box for exact block means. */
void vice_project_smooth(const float* y, float* raw, int w, int h, int s, int c, int iterations);
/* Smooth back-projection rounds used by vice_project. */
#define VICE_SMOOTH_ITERS 4

/* Hierarchical 2-level multi-grid consistency solver: coarse-to-fine residual restriction
   and prolongation eliminates low-frequency haloing and accelerates convergence. */
void vice_project_multigrid(const float* y, float* raw, int w, int h, int s, int c, int cycles);

/* Streaming strip / band context for memory-bounded processing of gigapixel images.
   Requires only a rolling ring buffer in memory at any time (~16MB to 32MB). */
typedef struct vice_stream_ctx vice_stream_ctx;
vice_stream_ctx* vice_stream_create(int in_w, int in_h, int scale, int channels, int band_h);
int vice_stream_push_input_rows(vice_stream_ctx* sctx, const float* in_rows, int row_count);
int vice_stream_has_next_band(const vice_stream_ctx* sctx);
int vice_stream_pull_band(vice_stream_ctx* sctx, unsigned char* out_bytes, int* written_rows);
void vice_stream_destroy(vice_stream_ctx* sctx);

float vice_srgb_to_linear(float v);
float vice_linear_to_srgb(float v);
float vice_fast_linear_to_srgb(float v);
float vice_fast_srgb_to_linear(float v);
float vice_spatial_triangular_dither(int x, int y, int ch);

#ifdef __cplusplus
}
#endif
