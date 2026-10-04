// PNG writer v2: adaptive per-row filter (None/Sub/Up/Paeth by minimum sum
// of absolute values) + miniz DEFLATE (level 6: size/speed balance — the
// explicit pixo-style tradeoff from the spec; revisit with benchmarks).
// miniz is MIT (see miniz.c header); crc/adler kept local (few lines).
#include "png.h"
#define MINIZ_NO_ZLIB_COMPATIBLE_NAMES
#include "miniz.h"
#include "vice.h"
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

// Compressed iCCP payload emission shared by the one-shot and streaming writers.
static void append_iccp(std::vector<unsigned char>& o, const unsigned char* icc_data,
                        size_t icc_size) {
  if (!icc_data || icc_size == 0) return;
  const char profile_name[] = "ICC Profile";
  size_t name_len = sizeof(profile_name); // includes null terminator
  mz_ulong comp_bound = mz_compressBound((mz_ulong)icc_size);
  std::vector<unsigned char> comp_icc((size_t)comp_bound);
  mz_ulong comp_len = comp_bound;
  if (mz_compress2(comp_icc.data(), &comp_len, icc_data, (mz_ulong)icc_size, 9) == MZ_OK) {
    std::vector<unsigned char> iccp_payload;
    iccp_payload.reserve(name_len + 1 + comp_len);
    iccp_payload.insert(iccp_payload.end(), (const unsigned char*)profile_name,
                        (const unsigned char*)profile_name + name_len);
    iccp_payload.push_back(0); // compression method 0 = DEFLATE
    iccp_payload.insert(iccp_payload.end(), comp_icc.data(), comp_icc.data() + comp_len);
    chunk(o, "iCCP", iccp_payload.data(), iccp_payload.size());
  }
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

// Adaptive filter selection shared by both writers: tries all 5 PNG filters,
// keeps the minimum sum-of-absolute-values row. crow holds stride+1 bytes.
static void filter_best_row(const unsigned char* row, const unsigned char* prev_or_null,
                            unsigned char* crow, unsigned char* cand, size_t stride,
                            int bpp) {
  unsigned best_sad = 0;
  // Test all 5 standard PNG filters: 0=None, 1=Sub, 2=Up, 3=Average, 4=Paeth
  for (int f : {0, 1, 2, 3, 4}) {
    unsigned sad = filter_row(row, prev_or_null, cand, stride, bpp, f);
    if (f == 0 || sad < best_sad) {
      best_sad = sad;
      std::memcpy(crow, cand, stride + 1);
    }
  }
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
  append_iccp(out, icc_data, icc_size);

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

    filter_best_row(row, have_prev ? prev.data() : nullptr, crow.data(), cand.data(),
                      out_stride, out_channels);
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

// ---------------------------------------------------------------------------
// Incremental PNG writer: fixed memory budget regardless of image height.
// One zlib stream (2-byte header + raw DEFLATE + Adler-32) is split across
// consecutive IDAT chunks framed at kIdatMax payload bytes.
// ---------------------------------------------------------------------------

namespace {
constexpr size_t kIdatMax = 256u * 1024u; // max IDAT payload per chunk
constexpr size_t kDeflateOut = 64u * 1024u; // per-call DEFLATE output buffer
} // namespace

struct vice_png_stream {
  int w = 0, h = 0, in_ch = 0, out_ch = 0;
  size_t out_stride = 0;
  int rows_written = 0;
  bool finished = false;
  bool ok = true;
  std::vector<unsigned char> prev; // previous packed row (filter reference)
  std::vector<unsigned char> packed; // RGBA->RGB staging when in_ch != out_ch
  std::vector<unsigned char> cand; // filter candidate (stride+1)
  std::vector<unsigned char> crow; // chosen filtered row (stride+1)
  std::vector<unsigned char> pending; // framed PNG bytes awaiting drain
  std::vector<unsigned char> stage; // unframed raw-deflate output
  std::vector<unsigned char> dfl; // per-call DEFLATE output (heap: 64KB would overflow the WASM stack)
  uint32_t adler = 1;
  mz_stream dstr{};
  bool dstr_ok = false;
  size_t peak_pending = 0;
};

static void png_note_peak(vice_png_stream* st) {
  size_t cur = st->pending.size() + st->stage.size();
  if (cur > st->peak_pending) st->peak_pending = cur;
}

// Incremental Adler-32 over filtered bytes (NMAX batching, zlib algorithm).
static uint32_t adler_extend(uint32_t adler, const unsigned char* d, size_t n) {
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

// Frame staged deflate bytes into IDAT chunks (full kIdatMax payloads, or
// everything when final_flush).
static void png_flush_stage(vice_png_stream* st, bool final_flush) {
  while (st->stage.size() >= kIdatMax ||
         (final_flush && !st->stage.empty())) {
    size_t n = st->stage.size() > kIdatMax ? kIdatMax : st->stage.size();
    if (!final_flush && n < kIdatMax) break;
    chunk(st->pending, "IDAT", st->stage.data(), n);
    st->stage.erase(st->stage.begin(), st->stage.begin() + (ptrdiff_t)n);
  }
  png_note_peak(st);
}

static void png_stage_bytes(vice_png_stream* st, const unsigned char* d, size_t n) {
  if (d && n) st->stage.insert(st->stage.end(), d, d + n);
  png_flush_stage(st, false);
}

// Feed bytes through the raw-deflate stream; MZ_FINISH drains to STREAM_END.
// miniz avail_in/avail_out are 32-bit: large inputs go in bounded pieces.
static int png_deflate_feed(vice_png_stream* st, const unsigned char* in, size_t n,
                            int flush) {
  unsigned char* out = st->dfl.data();
  const size_t out_cap = st->dfl.size();
  while (n > 0) {
    size_t step = n > 65536 ? 65536 : n;
    st->dstr.next_in = in;
    st->dstr.avail_in = (unsigned int)step;
    for (;;) {
      st->dstr.next_out = out;
      st->dstr.avail_out = (unsigned int)out_cap;
      int rc = mz_deflate(&st->dstr, MZ_NO_FLUSH);
      size_t produced = out_cap - st->dstr.avail_out;
      if (produced) png_stage_bytes(st, out, produced);
      if (rc != MZ_OK) return -1;
      if (st->dstr.avail_in == 0) break;
    }
    in += step;
    n -= step;
  }
  if (flush == MZ_FINISH) {
    for (;;) {
      st->dstr.next_in = nullptr;
      st->dstr.avail_in = 0;
      st->dstr.next_out = out;
      st->dstr.avail_out = (unsigned int)out_cap;
      int rc = mz_deflate(&st->dstr, MZ_FINISH);
      size_t produced = out_cap - st->dstr.avail_out;
      if (produced) png_stage_bytes(st, out, produced);
      if (rc == MZ_STREAM_END) return 0;
      if (rc != MZ_OK) return -1;
    }
  }
  return 0;
}

vice_png_stream* vice_png_open(int w, int h, int in_channels, int out_channels,
                               const unsigned char* icc_data, size_t icc_size) {
  if (w <= 0 || h <= 0 || w > 100000 || h > 100000) return nullptr;
  if ((in_channels != 3 && in_channels != 4) ||
      (out_channels != 3 && out_channels != 4))
    return nullptr;
  if (out_channels > in_channels) return nullptr;
  if (icc_data == nullptr) icc_size = 0;
  if (icc_size > 16u * 1024u * 1024u) return nullptr;
  auto* st = new (std::nothrow) vice_png_stream();
  if (!st) return nullptr;
  st->w = w;
  st->h = h;
  st->in_ch = in_channels;
  st->out_ch = out_channels;
  st->out_stride = (size_t)w * (size_t)out_channels;
#ifdef __EMSCRIPTEN__
  // -fno-exceptions: allocation failure aborts (Emscripten default).
  st->prev.assign(st->out_stride, 0);
  st->packed.resize(st->out_stride);
  st->cand.resize(st->out_stride + 1);
  st->crow.resize(st->out_stride + 1);
  st->dfl.resize(kDeflateOut);
#else
  try {
    st->prev.assign(st->out_stride, 0);
    st->packed.resize(st->out_stride);
    st->cand.resize(st->out_stride + 1);
    st->crow.resize(st->out_stride + 1);
    st->dfl.resize(kDeflateOut);
  } catch (...) {
    delete st;
    return nullptr;
  }
#endif
  const unsigned char sig[8] = {137, 80, 78, 71, 13, 10, 26, 10};
  st->pending.insert(st->pending.end(), sig, sig + 8);
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
  chunk(st->pending, "IHDR", ihdr, 13);
  append_iccp(st->pending, icc_data, icc_size);
  // Raw DEFLATE (no zlib wrapper from miniz); the 2-byte zlib header opens
  // the IDAT payload and Adler-32 closes it at vice_png_close.
  if (mz_deflateInit2(&st->dstr, 6, MZ_DEFLATED, -MZ_DEFAULT_WINDOW_BITS, 9,
                      MZ_DEFAULT_STRATEGY) != MZ_OK) {
    delete st;
    return nullptr;
  }
  st->dstr_ok = true;
  const unsigned char zlib_hdr[2] = {0x78, 0x9c}; // CMF/FLG, default level
  png_stage_bytes(st, zlib_hdr, 2);
  png_note_peak(st);
  return st;
}

int vice_png_write_rows(vice_png_stream* st, const unsigned char* rows, int row_count) {
  if (!st || !rows || row_count <= 0 || st->finished || !st->ok) return -1;
  if (row_count > st->h - st->rows_written) return -1;
  size_t in_stride = (size_t)st->w * (size_t)st->in_ch;
  for (int r = 0; r < row_count; r++) {
    const unsigned char* in = rows + (size_t)r * in_stride;
    const unsigned char* row = in;
    if (st->in_ch == 4 && st->out_ch == 3) {
      for (int x = 0; x < st->w; ++x) {
        st->packed[(size_t)x * 3 + 0] = in[(size_t)x * 4 + 0];
        st->packed[(size_t)x * 3 + 1] = in[(size_t)x * 4 + 1];
        st->packed[(size_t)x * 3 + 2] = in[(size_t)x * 4 + 2];
      }
      row = st->packed.data();
    }
    filter_best_row(row, st->rows_written ? st->prev.data() : nullptr, st->crow.data(),
                    st->cand.data(), st->out_stride, st->out_ch);
    st->adler = adler_extend(st->adler, st->crow.data(), st->out_stride + 1);
    if (png_deflate_feed(st, st->crow.data(), st->out_stride + 1, MZ_NO_FLUSH) != 0) {
      st->ok = false;
      return -1;
    }
    std::memcpy(st->prev.data(), row, st->out_stride);
    st->rows_written++;
  }
  png_note_peak(st);
  return 0;
}

int vice_png_drain(vice_png_stream* st, unsigned char* out, size_t cap, size_t* written) {
  if (!st || !out || !written) return -1;
  size_t n = cap < st->pending.size() ? cap : st->pending.size();
  if (n) {
    std::memcpy(out, st->pending.data(), n);
    st->pending.erase(st->pending.begin(), st->pending.begin() + (ptrdiff_t)n);
  }
  *written = n;
  return 0;
}

int vice_png_close(vice_png_stream* st) {
  if (!st || !st->ok || st->finished) return (st && st->finished) ? 0 : -1;
  if (st->rows_written != st->h) return -1;
  if (png_deflate_feed(st, nullptr, 0, MZ_FINISH) != 0) return -1;
  mz_deflateEnd(&st->dstr);
  st->dstr_ok = false;
  unsigned char ad[4];
  ad[0] = (unsigned char)(st->adler >> 24);
  ad[1] = (unsigned char)(st->adler >> 16);
  ad[2] = (unsigned char)(st->adler >> 8);
  ad[3] = (unsigned char)st->adler;
  png_stage_bytes(st, ad, 4);
  png_flush_stage(st, true);
  chunk(st->pending, "IEND", nullptr, 0);
  st->finished = true;
  png_note_peak(st);
  return 0;
}

void vice_png_destroy(vice_png_stream* st) {
  if (!st) return;
  if (st->dstr_ok) mz_deflateEnd(&st->dstr);
  delete st;
}

size_t vice_png_peak_pending(const vice_png_stream* st) {
  return st ? st->peak_pending : 0;
}
