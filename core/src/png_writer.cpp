#include "vice.h"
#include "png_filters.h"
#define MINIZ_NO_ZLIB_COMPATIBLE_NAMES
#include "miniz.h"
#include <cstdlib>
#include <cstring>
#include <vector>

namespace {
constexpr size_t kIdatMax = 256u * 1024u;
constexpr size_t kDeflateOut = 64u * 1024u;
} // namespace

struct vice_png_stream {
  int w = 0, h = 0, in_ch = 0, out_ch = 0;
  size_t out_stride = 0;
  int rows_written = 0;
  bool finished = false;
  bool ok = true;
  std::vector<unsigned char> prev;
  std::vector<unsigned char> packed;
  std::vector<unsigned char> cand;
  std::vector<unsigned char> crow;
  std::vector<unsigned char> pending;
  std::vector<unsigned char> stage;
  std::vector<unsigned char> dfl;
  uint32_t adler = 1;
  mz_stream dstr{};
  bool dstr_ok = false;
  size_t peak_pending = 0;
};

static void png_note_peak(vice_png_stream* st) {
  size_t cur = st->pending.size() + st->stage.size();
  if (cur > st->peak_pending) st->peak_pending = cur;
}

static void png_flush_stage(vice_png_stream* st, bool final_flush) {
  while (st->stage.size() >= kIdatMax || (final_flush && !st->stage.empty())) {
    size_t n = st->stage.size() > kIdatMax ? kIdatMax : st->stage.size();
    if (!final_flush && n < kIdatMax) break;
    png_chunk(st->pending, "IDAT", st->stage.data(), n);
    st->stage.erase(st->stage.begin(), st->stage.begin() + (ptrdiff_t)n);
  }
  png_note_peak(st);
}

static void png_stage_bytes(vice_png_stream* st, const unsigned char* d, size_t n) {
  if (d && n) st->stage.insert(st->stage.end(), d, d + n);
  png_flush_stage(st, false);
}

static int png_deflate_feed(vice_png_stream* st, const unsigned char* in, size_t n, int flush) {
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
  if ((in_channels != 3 && in_channels != 4) || (out_channels != 3 && out_channels != 4))
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
  png_chunk(st->pending, "IHDR", ihdr, 13);
  append_iccp(st->pending, icc_data, icc_size);
  if (mz_deflateInit2(&st->dstr, 6, MZ_DEFLATED, -MZ_DEFAULT_WINDOW_BITS, 9,
                      MZ_DEFAULT_STRATEGY) != MZ_OK) {
    delete st;
    return nullptr;
  }
  st->dstr_ok = true;
  const unsigned char zlib_hdr[2] = {0x78, 0x9c};
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
  png_chunk(st->pending, "IEND", nullptr, 0);
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

// --- Independent DEFLATE segments (slab workers) ---------------------------
// One segment = one slab's filtered rows, compressed with a slab-local
// dictionary: the first row may only use None/Sub (its previous row lives in
// another worker), and the segment ends with FULL_FLUSH (or FINISH for the
// last slab) so the byte stream stays one valid zlib sequence when the
// coordinator concatenates segments in order behind a single header/trailer.
// Per-slab scratch is worker-local; nothing here touches shared state.

struct vice_png_segment {
  int w = 0, rows = 0, in_ch = 0, out_ch = 0;
  size_t out_stride = 0;
  int rows_written = 0;
  bool finished = false;
  bool ok = true;
  std::vector<unsigned char> prev;
  std::vector<unsigned char> packed;
  std::vector<unsigned char> cand;
  std::vector<unsigned char> crow;
  std::vector<unsigned char> pending;
  // Heap deflate scratch: a 64 KB stack array would overflow the WASM stack
  // (same reason the serial writer keeps dfl on the heap).
  std::vector<unsigned char> dfl;
  uint32_t adler = 1;
  size_t raw_len = 0;
  mz_stream dstr{};
  bool dstr_ok = false;
};

static int png_seg_feed(vice_png_segment* sg, const unsigned char* in, size_t n, int flush) {
  unsigned char* out = sg->dfl.data();
  const size_t out_cap = sg->dfl.size();
  while (n > 0) {
    size_t step = n > 65536 ? 65536 : n;
    sg->dstr.next_in = in;
    sg->dstr.avail_in = (unsigned int)step;
    for (;;) {
      sg->dstr.next_out = out;
      sg->dstr.avail_out = (unsigned int)out_cap;
      int rc = mz_deflate(&sg->dstr, MZ_NO_FLUSH);
      size_t produced = out_cap - sg->dstr.avail_out;
      if (produced) sg->pending.insert(sg->pending.end(), out, out + produced);
      if (rc != MZ_OK) return -1;
      if (sg->dstr.avail_in == 0) break;
    }
    in += step;
    n -= step;
  }
  if (flush == MZ_FINISH) {
    for (;;) {
      sg->dstr.next_in = nullptr;
      sg->dstr.avail_in = 0;
      sg->dstr.next_out = out;
      sg->dstr.avail_out = (unsigned int)out_cap;
      int rc = mz_deflate(&sg->dstr, MZ_FINISH);
      size_t produced = out_cap - sg->dstr.avail_out;
      if (produced) sg->pending.insert(sg->pending.end(), out, out + produced);
      if (rc == MZ_STREAM_END) return 0;
      if (rc != MZ_OK) return -1;
    }
  }
  if (flush == MZ_FULL_FLUSH) {
    // Sync marker is a few bytes; repeat only if the buffer filled exactly.
    do {
      sg->dstr.next_in = nullptr;
      sg->dstr.avail_in = 0;
      sg->dstr.next_out = out;
      sg->dstr.avail_out = (unsigned int)out_cap;
      int rc = mz_deflate(&sg->dstr, MZ_FULL_FLUSH);
      size_t produced = out_cap - sg->dstr.avail_out;
      if (produced) sg->pending.insert(sg->pending.end(), out, out + produced);
      if (rc != MZ_OK) return -1;
    } while (sg->dstr.avail_out == 0);
    return 0;
  }
  return 0;
}

vice_png_segment* vice_png_segment_open(int w, int rows, int in_channels, int out_channels) {
  if (w <= 0 || rows <= 0 || w > 100000 || rows > 100000) return nullptr;
  if ((in_channels != 3 && in_channels != 4) || (out_channels != 3 && out_channels != 4))
    return nullptr;
  if (out_channels > in_channels) return nullptr;
  auto* sg = new (std::nothrow) vice_png_segment();
  if (!sg) return nullptr;
  sg->w = w;
  sg->rows = rows;
  sg->in_ch = in_channels;
  sg->out_ch = out_channels;
  sg->out_stride = (size_t)w * (size_t)out_channels;
#ifdef __EMSCRIPTEN__
  sg->prev.assign(sg->out_stride, 0);
  sg->packed.resize(sg->out_stride);
  sg->cand.resize(sg->out_stride + 1);
  sg->crow.resize(sg->out_stride + 1);
  sg->dfl.resize(kDeflateOut);
#else
  try {
    sg->prev.assign(sg->out_stride, 0);
    sg->packed.resize(sg->out_stride);
    sg->cand.resize(sg->out_stride + 1);
    sg->crow.resize(sg->out_stride + 1);
    sg->dfl.resize(kDeflateOut);
  } catch (...) {
    delete sg;
    return nullptr;
  }
#endif
  if (mz_deflateInit2(&sg->dstr, 6, MZ_DEFLATED, -MZ_DEFAULT_WINDOW_BITS, 9,
                      MZ_DEFAULT_STRATEGY) != MZ_OK) {
    delete sg;
    return nullptr;
  }
  sg->dstr_ok = true;
  return sg;
}

int vice_png_segment_write_rows(vice_png_segment* sg, const unsigned char* rows, int row_count) {
  if (!sg || !rows || row_count <= 0 || sg->finished || !sg->ok) return -1;
  if (row_count > sg->rows - sg->rows_written) return -1;
  size_t in_stride = (size_t)sg->w * (size_t)sg->in_ch;
  for (int r = 0; r < row_count; r++) {
    const unsigned char* in = rows + (size_t)r * in_stride;
    const unsigned char* row = in;
    if (sg->in_ch == 4 && sg->out_ch == 3) {
      for (int x = 0; x < sg->w; ++x) {
        sg->packed[(size_t)x * 3 + 0] = in[(size_t)x * 4 + 0];
        sg->packed[(size_t)x * 3 + 1] = in[(size_t)x * 4 + 1];
        sg->packed[(size_t)x * 3 + 2] = in[(size_t)x * 4 + 2];
      }
      row = sg->packed.data();
    }
    if (sg->rows_written == 0 && r == 0)
      filter_best_first_row(row, sg->crow.data(), sg->cand.data(), sg->out_stride,
                            sg->out_ch);
    else
      filter_best_row(row, sg->prev.data(), sg->crow.data(), sg->cand.data(), sg->out_stride,
                      sg->out_ch);
    sg->adler = adler_extend(sg->adler, sg->crow.data(), sg->out_stride + 1);
    sg->raw_len += sg->out_stride + 1;
    if (png_seg_feed(sg, sg->crow.data(), sg->out_stride + 1, MZ_NO_FLUSH) != 0) {
      sg->ok = false;
      return -1;
    }
    std::memcpy(sg->prev.data(), row, sg->out_stride);
    sg->rows_written++;
  }
  return 0;
}

int vice_png_segment_finish(vice_png_segment* sg, int is_last, uint32_t* adler,
                            size_t* raw_len) {
  if (!sg || !sg->ok || sg->finished) return -1;
  if (sg->rows_written != sg->rows) return -1;
  if (png_seg_feed(sg, nullptr, 0, is_last ? MZ_FINISH : MZ_FULL_FLUSH) != 0) return -1;
  mz_deflateEnd(&sg->dstr);
  sg->dstr_ok = false;
  sg->finished = true;
  if (adler) *adler = sg->adler;
  if (raw_len) *raw_len = sg->raw_len;
  return 0;
}

int vice_png_segment_drain(vice_png_segment* sg, unsigned char* out, size_t cap,
                           size_t* written) {
  if (!sg || !out || !written) return -1;
  size_t n = cap < sg->pending.size() ? cap : sg->pending.size();
  if (n) {
    std::memcpy(out, sg->pending.data(), n);
    sg->pending.erase(sg->pending.begin(), sg->pending.begin() + (ptrdiff_t)n);
  }
  *written = n;
  return 0;
}

void vice_png_segment_destroy(vice_png_segment* sg) {
  if (!sg) return;
  if (sg->dstr_ok) mz_deflateEnd(&sg->dstr);
  delete sg;
}
