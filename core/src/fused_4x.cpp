#include "vice.h"
#include "fused_4x.h"
#include <vector>

int vice_render_fused_4x_strip(
    const float* in_strip, int in_w, int req_in_rows, int channels,
    int fused_mode,
    std::vector<float>& scratch_tmp, std::vector<float>& scratch_big) {
  if (!in_strip || in_w <= 0 || req_in_rows <= 0 ||
      (channels != 3 && channels != 4))
    return -1;
  if (fused_mode != 1 && fused_mode != 2) return -1;
  int tmp_w = in_w * 2;
  int tmp_h = req_in_rows * 2;
  int big_h = req_in_rows * 4;
  size_t out_row_stride = (size_t)in_w * 4 * channels;
  scratch_tmp.resize((size_t)tmp_h * tmp_w * channels);
  scratch_big.resize((size_t)big_h * out_row_stride);
  if (vice_upscale_lanczos_adaptive(in_strip, in_w, req_in_rows,
                                    channels, 2, scratch_tmp.data()) != 0)
    return -1;
  int second;
  if (fused_mode == 1) {
    // Clean: never re-sharpen the already-sharpened mid image.
    second = vice_upscale_lanczos_adaptive_plain(scratch_tmp.data(), tmp_w, tmp_h,
                                                channels, 2, scratch_big.data());
  } else {
    second = vice_upscale_lanczos_adaptive(scratch_tmp.data(), tmp_w, tmp_h,
                                          channels, 2, scratch_big.data());
  }
  if (second != 0) return -1;
  return 0;
}
