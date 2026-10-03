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

/* L-inf residual ||A(out)-y|| after last project (float domain). */
double vice_last_residual(const vice_ctx* ctx);

void vice_destroy(vice_ctx* ctx);

/* Pure helpers exposed for tests (no ctx needed). */
void vice_project_box(const float* y, float* raw, int w, int h, int s, int c);
float vice_srgb_to_linear(float v);
float vice_linear_to_srgb(float v);

#ifdef __cplusplus
}
#endif
