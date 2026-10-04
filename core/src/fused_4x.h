#include "vice.h"

void vice_render_fused_4x_strip(
    const float* in_strip, int in_w, int req_in_rows, int channels,
    int fused_mode,
    int out_y0, int cur_band_h, int req_in_y0,
    float* band_raw);
