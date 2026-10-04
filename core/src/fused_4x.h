#include "vice.h"
#include <vector>

// Plain second-pass upscaler (Lanczos + dering, no sharpness/shock).
// Defined in upscale.cpp; internal to the native core, not exported to WASM.
int vice_upscale_lanczos_adaptive_plain(const float* src, int w, int h, int c, int scale,
                                        float* dst);

// Renders the owned output band [out_y0, out_y0 + cur_band_h) for a fused
// chained 4x strip. fused_mode 1 = clean (plain second pass, shipped default),
// 2 = detail (full tuning on both passes). Scratch vectors are caller-owned
// band buffers reused across bands to avoid per-band allocation.
// Returns 0 ok, <0 on bad args or missing strip rows (never silent zeros).
int vice_render_fused_4x_strip(
    const float* in_strip, int in_w, int req_in_rows, int channels,
    int fused_mode,
    int out_y0, int cur_band_h, int req_in_y0,
    float* band_raw,
    std::vector<float>& scratch_tmp, std::vector<float>& scratch_big);
