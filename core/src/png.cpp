// PNG writer v2: adaptive per-row filter (None/Sub/Up/Paeth by minimum sum
// of absolute values) + miniz DEFLATE (level 6: size/speed balance — the
// explicit pixo-style tradeoff from the spec; revisit with benchmarks).
// miniz is MIT (see miniz.c header); crc/adler kept local (few lines).
#include "png.h"
#include "miniz.h"
#include <cstdlib>
#include <cstring>

static uint32_t crc_table[256];
static bool crc_ready = false;
static void crc_init() {
  if (crc_ready) return;
  for (uint32_t n = 0; n < 256; n++) {
    uint32_t c = n;
    for (int k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320u ^ (c >> 1)) : (c >> 1);
    crc_table[n] = c;
  }
  crc_ready = true;
}
uint32_t vice_crc32(const unsigned char* d, size_t n) {
  crc_init();
  uint32_t c = 0xffffffffu;
  for (size_t i = 0; i < n; i++) c = crc_table[(c ^ d[i]) & 0xff] ^ (c >> 8);
  return c ^ 0xffffffffu;
}
uint32_t vice_adler32(const unsigned char* d, size_t n) {
  const uint32_t MOD = 65521;
  uint32_t a = 1, b = 0;
  for (size_t i = 0; i < n; i++) {
    a = (a + d[i]) % MOD;
    b = (b + a) % MOD;
  }
  return (b << 16) | a;
}

static void put32(std::vector<unsigned char>& o, uint32_t v) {
  o.push_back((unsigned char)(v >> 24));
  o.push_back((unsigned char)(v >> 16));
  o.push_back((unsigned char)(v >> 8));
  o.push_back((unsigned char)v);
}
static void chunk(std::vector<unsigned char>& o, const char* type,
                  const unsigned char* d, size_t n) {
  put32(o, (uint32_t)n);
  size_t h0 = o.size();
  for (int i = 0; i < 4; i++) o.push_back((unsigned char)type[i]);
  if (d && n) o.insert(o.end(), d, d + n);
  uint32_t c = vice_crc32(o.data() + h0, 4 + n);
  put32(o, c);
}

static int paeth_pred(int a, int b, int c) {
  int p = a + b - c, pa = std::abs(p - a), pb = std::abs(p - b), pc = std::abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// Filter one row into out (stride+1 bytes, out[0] = filter id). Returns SAD.
static unsigned filter_row(const unsigned char* row, const unsigned char* prev,
                           unsigned char* out, size_t stride, int bpp, int f) {
  out[0] = (unsigned char)f;
  unsigned sad = 0;
  for (size_t i = 0; i < stride; i++) {
    int a = i >= (size_t)bpp ? row[i - bpp] : 0;
    int b = prev ? prev[i] : 0;
    int cc = (prev && i >= (size_t)bpp) ? prev[i - bpp] : 0;
    int v = 0;
    switch (f) {
      case 0: v = row[i]; break;
      case 1: v = row[i] - a; break;
      case 2: v = row[i] - b; break;
      case 3: v = row[i] - ((a + b) >> 1); break;
      case 4: v = row[i] - paeth_pred(a, b, cc); break;
      default: v = row[i]; break;
    }
    out[1 + i] = (unsigned char)v;
    int s = (signed char)(unsigned char)v;
    sad += (unsigned)(s < 0 ? -s : s);
  }
  return sad;
}

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
  // drop alpha channel to encode 3-channel RGB. Saves 25% data with ZERO quality loss.
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
  chunk(out, "IHDR", ihdr, 13);

  // If ICC profile is present, emit iCCP chunk right after IHDR
  if (icc_data && icc_size > 0) {
    const char profile_name[] = "ICC Profile";
    size_t name_len = sizeof(profile_name); // includes null terminator
    mz_ulong comp_bound = mz_compressBound((mz_ulong)icc_size);
    std::vector<unsigned char> comp_icc((size_t)comp_bound);
    mz_ulong comp_len = comp_bound;
    if (mz_compress2(comp_icc.data(), &comp_len, icc_data, (mz_ulong)icc_size, 9) == MZ_OK) {
      std::vector<unsigned char> iccp_payload;
      iccp_payload.reserve(name_len + 1 + comp_len);
      iccp_payload.insert(iccp_payload.end(), (const unsigned char*)profile_name, (const unsigned char*)profile_name + name_len);
      iccp_payload.push_back(0); // compression method 0 = DEFLATE
      iccp_payload.insert(iccp_payload.end(), comp_icc.data(), comp_icc.data() + comp_len);
      chunk(out, "iCCP", iccp_payload.data(), iccp_payload.size());
    }
  }

  const size_t in_stride = (size_t)w * channels;
  const size_t out_stride = (size_t)w * out_channels;
  std::vector<unsigned char> packed_row;
  if (channels == 4 && out_channels == 3) {
    packed_row.resize(out_stride);
  }

  std::vector<unsigned char> raw;
  raw.reserve((out_stride + 1) * (size_t)h);
  std::vector<unsigned char> cand(out_stride + 1), prev(out_stride, 0);
  std::vector<unsigned char> crow(out_stride + 1);
  bool have_prev = false;

  for (int y = 0; y < h; y++) {
    const unsigned char* in_row = rgba + (size_t)y * in_stride;
    const unsigned char* row = in_row;
    if (channels == 4 && out_channels == 3) {
      for (int x = 0; x < w; ++x) {
        packed_row[x * 3 + 0] = in_row[x * 4 + 0];
        packed_row[x * 3 + 1] = in_row[x * 4 + 1];
        packed_row[x * 3 + 2] = in_row[x * 4 + 2];
      }
      row = packed_row.data();
    }

    unsigned best_sad = 0;
    int best_f = 0;
    // Test all 5 standard PNG filters: 0=None, 1=Sub, 2=Up, 3=Average, 4=Paeth
    for (int f : {0, 1, 2, 3, 4}) {
      unsigned sad = filter_row(row, have_prev ? prev.data() : nullptr, cand.data(),
                                out_stride, out_channels, f);
      if (f == 0 || sad < best_sad) {
        best_sad = sad;
        best_f = f;
        std::memcpy(crow.data(), cand.data(), out_stride + 1);
      }
    }
    raw.insert(raw.end(), crow.data(), crow.data() + out_stride + 1);
    std::memcpy(prev.data(), row, out_stride);
    have_prev = true;
  }

  mz_ulong bound = mz_compressBound((mz_ulong)raw.size());
  std::vector<unsigned char> z((size_t)bound);
  mz_ulong zlen = bound;
  // Level 9 = Maximum DEFLATE compression with exhaustive match search
  if (mz_compress2(z.data(), &zlen, raw.data(), (mz_ulong)raw.size(), 9) != MZ_OK)
    return -1;
  chunk(out, "IDAT", z.data(), (size_t)zlen);
  chunk(out, "IEND", nullptr, 0);
  return 0;
}
