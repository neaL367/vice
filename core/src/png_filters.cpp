#include "png_filters.h"
#define MINIZ_NO_ZLIB_COMPATIBLE_NAMES
#include "miniz.h"
#include <cmath>
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

uint32_t adler_extend(uint32_t adler, const unsigned char* d, size_t n) {
  const uint32_t MOD = 65521;
  uint32_t a = adler & 0xffffu, b = adler >> 16;
  while (n > 0) {
    size_t block = n > 5552 ? 5552 : n;
    n -= block;
    for (size_t i = 0; i < block; i++) {
      a += d[i];
      b += a;
    }
    d += block;
    a %= MOD;
    b %= MOD;
  }
  return (b << 16) | a;
}

void png_put32(std::vector<unsigned char>& o, uint32_t v) {
  o.push_back((unsigned char)(v >> 24));
  o.push_back((unsigned char)(v >> 16));
  o.push_back((unsigned char)(v >> 8));
  o.push_back((unsigned char)v);
}

void png_chunk(std::vector<unsigned char>& o, const char* type,
               const unsigned char* d, size_t n) {
  png_put32(o, (uint32_t)n);
  size_t h0 = o.size();
  for (int i = 0; i < 4; i++) o.push_back((unsigned char)type[i]);
  if (d && n) o.insert(o.end(), d, d + n);
  uint32_t c = vice_crc32(o.data() + h0, 4 + n);
  png_put32(o, c);
}

void append_iccp(std::vector<unsigned char>& o, const unsigned char* icc_data,
                 size_t icc_size) {
  if (!icc_data || icc_size == 0) return;
  const char profile_name[] = "ICC Profile";
  size_t name_len = sizeof(profile_name);
  mz_ulong comp_bound = mz_compressBound((mz_ulong)icc_size);
  std::vector<unsigned char> comp_icc((size_t)comp_bound);
  mz_ulong comp_len = comp_bound;
  if (mz_compress2(comp_icc.data(), &comp_len, icc_data, (mz_ulong)icc_size, 9) == MZ_OK) {
    std::vector<unsigned char> iccp_payload;
    iccp_payload.reserve(name_len + 1 + comp_len);
    iccp_payload.insert(iccp_payload.end(), (const unsigned char*)profile_name,
                        (const unsigned char*)profile_name + name_len);
    iccp_payload.push_back(0);
    iccp_payload.insert(iccp_payload.end(), comp_icc.data(), comp_icc.data() + comp_len);
    png_chunk(o, "iCCP", iccp_payload.data(), iccp_payload.size());
  }
}

int paeth_pred(int a, int b, int c) {
  int p = a + b - c, pa = std::abs(p - a), pb = std::abs(p - b), pc = std::abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

unsigned filter_row(const unsigned char* row, const unsigned char* prev,
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

void filter_best_row(const unsigned char* row, const unsigned char* prev_or_null,
                     unsigned char* crow, unsigned char* cand, size_t stride,
                     int bpp) {
  unsigned best_sad = 0;
  for (int f : {0, 1, 2, 3, 4}) {
    unsigned sad = filter_row(row, prev_or_null, cand, stride, bpp, f);
    if (f == 0 || sad < best_sad) {
      best_sad = sad;
      std::memcpy(crow, cand, stride + 1);
    }
  }
}
