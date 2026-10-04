#include "png.h"
#include "png_filters.h"
#define MINIZ_NO_ZLIB_COMPATIBLE_NAMES
#include "miniz.h"
#include "vice.h"
#include <cstdlib>
#include <cstring>
#include <vector>

int vice_encode_png(const unsigned char* rgba, int w, int h, int channels,
                    std::vector<unsigned char>& out) {
  return vice_encode_png_ex(rgba, w, h, channels, nullptr, 0, out);
}

int vice_encode_png_ex(const unsigned char* rgba, int w, int h, int channels,
                       const unsigned char* icc_data, size_t icc_size,
                       std::vector<unsigned char>& out) {
  if (w <= 0 || h <= 0 || (channels != 3 && channels != 4)) return -1;
  if (!rgba) return -1;
  out.clear();

  // Lossless Alpha Pruning: if an RGBA image has 100% opaque alpha (all 255),
  // drop alpha channel to encode 3-channel RGB.
  bool has_alpha = false;
  if (channels == 4) {
    for (size_t i = 0; i < (size_t)w * h; ++i) {
      if (rgba[i * 4 + 3] < 255) {
        has_alpha = true;
        break;
      }
    }
  }
  const int out_channels = (channels == 4 && has_alpha) ? 4 : 3;

  const unsigned char sig[8] = {137, 80, 78, 71, 13, 10, 26, 10};
  out.insert(out.end(), sig, sig + 8);
  unsigned char ihdr[13];
  ihdr[0] = (unsigned char)(w >> 24);
  ihdr[1] = (unsigned char)(w >> 16);
  ihdr[2] = (unsigned char)(w >> 8);
  ihdr[3] = (unsigned char)w;
  ihdr[4] = (unsigned char)(h >> 24);
  ihdr[5] = (unsigned char)(h >> 16);
  ihdr[6] = (unsigned char)(h >> 8);
  ihdr[7] = (unsigned char)h;
  ihdr[8] = 8;
  ihdr[9] = (out_channels == 4) ? 6 : 2;
  ihdr[10] = ihdr[11] = ihdr[12] = 0;
  png_chunk(out, "IHDR", ihdr, 13);
  append_iccp(out, icc_data, icc_size);

  const size_t in_stride = (size_t)w * channels;
  const size_t out_stride = (size_t)w * out_channels;
  const size_t raw_row = out_stride + 1;
  std::vector<unsigned char> raw(raw_row * h);
  std::vector<unsigned char> cand(raw_row);
  std::vector<unsigned char> packed_row(out_stride);

  for (int y = 0; y < h; y++) {
    const unsigned char* in_row = rgba + (size_t)y * in_stride;
    const unsigned char* row = in_row;
    if (channels == 4 && out_channels == 3) {
      for (int x = 0; x < w; ++x) {
        packed_row[(size_t)x * 3 + 0] = in_row[(size_t)x * 4 + 0];
        packed_row[(size_t)x * 3 + 1] = in_row[(size_t)x * 4 + 1];
        packed_row[(size_t)x * 3 + 2] = in_row[(size_t)x * 4 + 2];
      }
      row = packed_row.data();
    }
    const unsigned char* prev = (y > 0) ? (raw.data() + (size_t)(y - 1) * raw_row + 1) : nullptr;
    unsigned char* crow = raw.data() + (size_t)y * raw_row;
    filter_best_row(row, prev, crow, cand.data(), out_stride, out_channels);
  }

  mz_ulong bound = mz_compressBound((mz_ulong)raw.size());
  std::vector<unsigned char> z((size_t)bound);
  mz_ulong zlen = bound;
  if (mz_compress2(z.data(), &zlen, raw.data(), (mz_ulong)raw.size(), 9) != MZ_OK)
    return -1;
  png_chunk(out, "IDAT", z.data(), (size_t)zlen);
  png_chunk(out, "IEND", nullptr, 0);
  return 0;
}
