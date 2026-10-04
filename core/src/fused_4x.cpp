#include "vice.h"
#include <cstring>
#include <vector>

void vice_render_fused_4x_strip(
    const float* in_strip, int in_w, int req_in_rows, int channels,
    int fused_mode,
    int out_y0, int cur_band_h, int req_in_y0,
    float* band_raw) {
  (void)fused_mode;
  int tmp_w = in_w * 2;
  int tmp_h = req_in_rows * 2;
  int big_h = req_in_rows * 4;
  size_t out_row_stride = (size_t)in_w * 4 * channels;
  std::vector<float> tmp((size_t)tmp_h * tmp_w * channels);
  std::vector<float> big((size_t)big_h * out_row_stride);
  vice_upscale_lanczos_adaptive(in_strip, in_w, req_in_rows,
                                channels, 2, tmp.data());
  vice_upscale_lanczos_adaptive(tmp.data(), tmp_w, tmp_h, channels, 2,
                                big.data());
  int strip_global_out_y0 = req_in_y0 * 4;
  int local_band_offset = out_y0 - strip_global_out_y0;
  for (int by = 0; by < cur_band_h; ++by) {
    int src_row = local_band_offset + by;
    if (src_row >= 0 && src_row < big_h) {
      std::memcpy(band_raw + (size_t)by * out_row_stride,
                  big.data() + (size_t)src_row * out_row_stride,
                  out_row_stride * sizeof(float));
    }
  }
}
