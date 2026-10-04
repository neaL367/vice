#pragma once
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* --- 1. Typed Status Codes --- */
typedef enum ViceStatus {
  VICE_OK = 0,
  VICE_INVALID_ARGUMENT = -1,
  VICE_OUT_OF_MEMORY = -2,
  VICE_BAD_STATE = -3,
  VICE_OUTPUT_BACKPRESSURE = -4,
  VICE_CANCELLED = -5,
} ViceStatus;

/* --- 2. Enums --- */
typedef enum ViceScale {
  VICE_SCALE_2X = 2,
  VICE_SCALE_3X = 3,
  VICE_SCALE_4X = 4,
} ViceScale;

/* --- 3. Unified Streaming Pipeline C ABI --- */
typedef struct vice_stream_ctx vice_stream_ctx;

vice_stream_ctx* vice_stream_create(int in_w, int in_h, int scale, int channels, int band_h);
int vice_stream_set_icc_profile(vice_stream_ctx* sctx, const unsigned char* data, size_t size);
int vice_stream_push_input_rows(vice_stream_ctx* sctx, const float* in_rows, int row_count);
int vice_stream_has_next_band(const vice_stream_ctx* sctx);
int vice_stream_pull_band(vice_stream_ctx* sctx, unsigned char* out_bytes, int* written_rows);
int vice_stream_finish_png(vice_stream_ctx* sctx, const unsigned char* rgba_rows, int n,
                           unsigned char* out, size_t cap, size_t* written);
double vice_stream_last_residual(const vice_stream_ctx* sctx);
void vice_stream_destroy(vice_stream_ctx* sctx);
int vice_stream_set_fused(vice_stream_ctx* sctx, int mode);

/* --- 4. Incremental PNG Writer C ABI --- */
typedef struct vice_png_stream vice_png_stream;

vice_png_stream* vice_png_open(int w, int h, int in_channels, int out_channels,
                               const unsigned char* icc_data, size_t icc_size);
int vice_png_write_rows(vice_png_stream* st, const unsigned char* rows, int row_count);
int vice_png_drain(vice_png_stream* st, unsigned char* out, size_t cap, size_t* written);
int vice_png_close(vice_png_stream* st);
void vice_png_destroy(vice_png_stream* st);
size_t vice_png_peak_pending(const vice_png_stream* st);

/* --- 5. Mathematical Core & Color Conversion --- */
#define VICE_SMOOTH_ITERS 4

int vice_upscale_lanczos_adaptive(const float* src, int w, int h, int c, int scale, float* dst);
void vice_project_box(const float* y, float* raw, int w, int h, int s, int c);
void vice_project_box_clamped(const float* y, float* raw, int w, int h, int s, int c);
void vice_project_smooth(const float* y, float* raw, int w, int h, int s, int c, int iterations);
void vice_project_multigrid(const float* y, float* raw, int w, int h, int s, int c, int cycles);

float vice_srgb_to_linear(float v);
float vice_linear_to_srgb(float v);
float vice_fast_linear_to_srgb(float v);
float vice_fast_srgb_to_linear(float v);
float vice_spatial_triangular_dither(int x, int y, int ch);
int vice_thread_workers(void);

/* --- 6. Compatibility Context C ABI --- */
typedef struct vice_ctx vice_ctx;

vice_ctx* vice_create(int in_w, int in_h, int scale, int channels);
int vice_set_input(vice_ctx* ctx, const float* y, int n);
int vice_submit_raw_tile(vice_ctx* ctx, int tx, int ty, const float* tile,
                         int tw, int th, int n);
int vice_project(vice_ctx* ctx);
int vice_download_raw(vice_ctx* ctx, float* out, int n);
int vice_process_band(vice_ctx* ctx, int band, unsigned char* out_rows,
                      int* out_row_count);
int vice_finish_png(vice_ctx* ctx, unsigned char* out, size_t cap,
                    size_t* written);
int vice_set_icc_profile(vice_ctx* ctx, const unsigned char* data, size_t size);
double vice_last_residual(const vice_ctx* ctx);
int vice_upscale(vice_ctx* ctx);
void vice_destroy(vice_ctx* ctx);

#ifdef __cplusplus
}
#endif
