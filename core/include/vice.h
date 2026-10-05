#pragma once
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Unified streaming pipeline C ABI: the only render path. */
typedef struct vice_stream_ctx vice_stream_ctx;

vice_stream_ctx* vice_stream_create(int in_w, int in_h, int scale, int channels, int band_h);
int vice_stream_set_icc_profile(vice_stream_ctx* sctx, const unsigned char* data, size_t size);
int vice_stream_push_input_rows(vice_stream_ctx* sctx, const float* in_rows, int row_count);
int vice_stream_has_next_band(const vice_stream_ctx* sctx);
/* Pull the next output band (8-bit sRGB bytes, band_h*out_w*channels max).
   NOTE: band_h is rounded UP to a multiple of scale internally, so size the
   caller's buffer for ((band_h + s - 1) / s) * s rows, not band_h.
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

/* Incremental PNG writer C ABI (infinite export path). */
typedef struct vice_png_stream vice_png_stream;

vice_png_stream* vice_png_open(int w, int h, int in_channels, int out_channels,
                               const unsigned char* icc_data, size_t icc_size);
int vice_png_write_rows(vice_png_stream* st, const unsigned char* rows, int row_count);
int vice_png_drain(vice_png_stream* st, unsigned char* out, size_t cap, size_t* written);
int vice_png_close(vice_png_stream* st);
void vice_png_destroy(vice_png_stream* st);
size_t vice_png_peak_pending(const vice_png_stream* st);

/* Mathematical core (kernels the stream engine builds on) & color conversion. */
#define VICE_SMOOTH_ITERS 4

int vice_upscale_lanczos_adaptive(const float* src, int w, int h, int c, int scale, float* dst);
void vice_project_box(const float* y, float* raw, int w, int h, int s, int c);
void vice_project_box_clamped(const float* y, float* raw, int w, int h, int s, int c);

float vice_srgb_to_linear(float v);
float vice_linear_to_srgb(float v);
float vice_fast_linear_to_srgb(float v);
float vice_fast_srgb_to_linear(float v);
float vice_spatial_triangular_dither(int x, int y, int ch);
int vice_thread_workers(void);

#ifdef __cplusplus
}
#endif
