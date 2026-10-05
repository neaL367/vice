#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Unified streaming pipeline C ABI: the only render path.
   Status codes (pull_band today; the rest of the surface follows): */
typedef enum ViceStatus {
  VICE_OK = 0,            /* band complete, more follow */
  VICE_DONE = 1,          /* final band complete */
  VICE_E_ARG = -1,        /* bad arguments or upscale failure */
  VICE_E_NEED_INPUT = -2, /* caller must push more input rows first */
  VICE_E_MISSING_ROW = -3, /* required input row missing: never silent zeros */
  VICE_E_STATE = -4,      /* call out of order (e.g. second begin_slab) */
  VICE_E_NOMEM = -5       /* allocation failure */
} ViceStatus;

#define VICE_ABI_VERSION 1u

/* ABI version handshake: JS checks this once at boot; mismatch is a hard
   error (replaces per-function typeof probing for the core surface). */
uint32_t vice_abi_version(void);

typedef struct vice_stream_ctx vice_stream_ctx;

vice_stream_ctx* vice_stream_create(int in_w, int in_h, int scale, int channels, int band_h);
int vice_stream_set_icc_profile(vice_stream_ctx* sctx, const unsigned char* data, size_t size);
int vice_stream_push_input_rows(vice_stream_ctx* sctx, const float* in_rows, int row_count);
int vice_stream_has_next_band(const vice_stream_ctx* sctx);
/* Pull the next output band (8-bit sRGB bytes, band_h*out_w*channels max).
   NOTE: band_h is rounded UP to a multiple of scale internally, so size the
   caller's buffer for ((band_h + s - 1) / s) * s rows, not band_h.
   Stored bytes are integer-exact per block: every s×s block sums to s²× the
   source byte (opaque blocks; translucent RGB keeps plain rounding, alpha
   sums are always exact). Box-downscaling the output with an ordinary tool
   recovers the source.
   Returns 1 (final band), 0 (more bands), -1 (bad args / upscale failure),
   -2 (caller must push more input rows first), -3 (required input row
   missing from the buffer: never emits silent black rows). */
int vice_stream_pull_band(vice_stream_ctx* sctx, unsigned char* out_bytes, int* written_rows);
int vice_stream_finish_png(vice_stream_ctx* sctx, const unsigned char* rgba_rows, int n,
                           unsigned char* out, size_t cap, size_t* written);
double vice_stream_last_residual(const vice_stream_ctx* sctx);
void vice_stream_destroy(vice_stream_ctx* sctx);
/* Fused chained 4x (scale-4 only): 1 = clean (full first pass, plain
   Lanczos+dering second pass so the mid image is never re-sharpened;
   shipped UI default), 2 = detail (full tuning on both passes, engine-only).
   Modes 1 and 2 produce different bytes by construction. */
int vice_stream_set_fused(vice_stream_ctx* sctx, int mode);

/* Slab rendering: halo rows needed beyond an owned output window.
   Mirrors the strip-req math (lanczos taps + fused halo + smooth halo);
   scale must be 2/3/4, else both outputs are 0. */
void vice_stream_halo_rows(int scale, int fused, int* top, int* bottom);

/* Begin a slab on a fresh ctx: rows pushed afterwards start at global input
   row in_y0 (including halo), and pulls start at global output row out_y0,
   which must be a multiple of scale. Returns VICE_E_STATE unless the ctx is
   fresh (nothing pushed or emitted yet), VICE_E_ARG on bad geometry. */
int vice_stream_begin_slab(vice_stream_ctx* sctx, int in_y0, int out_y0);

/* Upper-bound working-set estimate in bytes for a stream render with the
   given geometry. Covers retained input, strip scratch (upscale + fused
   intermediates + smooth + band buffers), the PNG writer, output accumulation
   (Blob route), the ≤1600px preview, and the WASM base heap. Deliberately
   generous: it must never under-predict (planner compares against a device
   ceiling). Returns 0 on bad geometry. Saturates instead of overflowing. */
size_t vice_stream_memory_bytes(int in_w, int in_h, int scale, int ch, int band_h, int fused);

/* Incremental PNG writer C ABI (infinite export path). */
typedef struct vice_png_stream vice_png_stream;

vice_png_stream* vice_png_open(int w, int h, int in_channels, int out_channels,
                               const unsigned char* icc_data, size_t icc_size);
int vice_png_write_rows(vice_png_stream* st, const unsigned char* rows, int row_count);
int vice_png_drain(vice_png_stream* st, unsigned char* out, size_t cap, size_t* written);
int vice_png_close(vice_png_stream* st);
void vice_png_destroy(vice_png_stream* st);
size_t vice_png_peak_pending(const vice_png_stream* st);

/* Independent DEFLATE segments (slab workers). One segment = one slab's
   filtered rows with a slab-local dictionary: first row restricted to
   None/Sub, ends with FULL_FLUSH (FINISH for the last slab) so concatenated
   segments in order form one valid zlib stream behind a single header.
   Reports the segment adler + filtered length for coordinator-side framing
   (vice_adler32_combine). */
typedef struct vice_png_segment vice_png_segment;

vice_png_segment* vice_png_segment_open(int w, int rows, int in_channels, int out_channels);
int vice_png_segment_write_rows(vice_png_segment* sg, const unsigned char* rows, int row_count);
int vice_png_segment_finish(vice_png_segment* sg, int is_last, uint32_t* adler, size_t* raw_len);
int vice_png_segment_drain(vice_png_segment* sg, unsigned char* out, size_t cap, size_t* written);
void vice_png_segment_destroy(vice_png_segment* sg);
uint32_t vice_adler32_combine(uint32_t ad1, uint32_t ad2, size_t len2);

/* Mathematical core (kernels the stream engine builds on) & color conversion. */
#define VICE_SMOOTH_ITERS 4

int vice_upscale_lanczos_adaptive(const float* src, int w, int h, int c, int scale, float* dst);
void vice_project_box(const float* y, float* raw, int w, int h, int s, int c);
void vice_project_box_clamped(const float* y, float* raw, int w, int h, int s, int c);

float vice_srgb_to_linear(float v);
float vice_linear_to_srgb(float v);
float vice_fast_linear_to_srgb(float v);
float vice_fast_srgb_to_linear(float v);
int vice_thread_workers(void);

#ifdef __cplusplus
}
#endif
