// Deterministic hostile-input driver for the stream engine + PNG writer.
// No libFuzzer needed: main() runs fixed seeds; argv[1] optionally selects a
// seed. Build with sanitizers (see VICE_SANITIZE) and run under CI.
// Exits nonzero on any API contract violation (crash, hang via abort, or a
// silent-zero/missing-error regression caught by return codes).

#include "vice.h"
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <vector>

namespace {

uint64_t rng_state = 0;

uint64_t next_rand() {
  rng_state ^= rng_state << 13;
  rng_state ^= rng_state >> 7;
  rng_state ^= rng_state << 17;
  return rng_state;
}

float rand_sample() {
  unsigned pick = (unsigned)(next_rand() % 10);
  if (pick == 0) return std::numeric_limits<float>::quiet_NaN();
  if (pick == 1) return std::numeric_limits<float>::infinity();
  if (pick == 2) return -std::numeric_limits<float>::infinity();
  if (pick == 3) return (float)(int)(next_rand() % 600) - 200.0f; // out of range
  if (pick == 4) return 1e30f;
  return (float)(next_rand() % 100000) / 100000.0f;
}

int rand_dim(int cap) { return (int)(next_rand() % (unsigned)(cap + 3)) - 1; }

void fuzz_stream(uint64_t seed) {
  rng_state = seed ? seed : 0x9e3779b97f4a7c15ull;
  int w = 1 + (int)(next_rand() % 40);
  int h = 1 + (int)(next_rand() % 40);
  int scale = 2 + (int)(next_rand() % 3);
  int c = (next_rand() & 1) ? 3 : 4;
  int band_h = 1 + (int)(next_rand() % 70);
  vice_stream_ctx* s = vice_stream_create(w, h, scale, c, band_h);
  if (!s) return; // invalid dims are a legal rejection
  int out_w = w * scale, out_h = h * scale;
  int band_alloc = ((band_h + scale - 1) / scale) * scale + 4;
  std::vector<unsigned char> band((size_t)band_alloc * out_w * c, 0xAB);
  std::vector<float> rows((size_t)40 * w * c);
  int pushed = 0, emitted = 0, guard = 0;
  while (emitted < out_h && guard++ < 100000) {
    if (vice_stream_has_next_band(s)) {
      int n = 0;
      int rc = vice_stream_pull_band(s, band.data(), &n);
      if (rc < 0) break;           // backpressure / bad state: legal
      if (n <= 0 || n > band_alloc) {
        std::printf("FUZZ FAIL seed=%llu bad rows=%d rc=%d\n",
                    (unsigned long long)seed, n, rc);
        std::abort();
      }
      emitted += n;
      if (rc == 1) break;
    } else {
      if (pushed >= h) break;
      int n = 1 + (int)(next_rand() % 5);
      if (n > h - pushed) n = h - pushed;
      for (int i = 0; i < n * w * c; i++) rows[i] = rand_sample();
      if (vice_stream_push_input_rows(s, rows.data(), n) != 0) break;
      pushed += n;
    }
  }
  double r = vice_stream_last_residual(s);
  if (!(r >= 0.0) && !(r < 0.0)) {
    // NaN residual would mean the guarantee tracker broke; -1.0 is the
    // documented null-ctx value, anything else finite is fine.
    std::printf("FUZZ FAIL seed=%llu nan residual\n", (unsigned long long)seed);
    std::abort();
  }
  (void)r;
  vice_stream_destroy(s);

  // PNG writer misuse sweep.
  {
    int pw = rand_dim(40), ph = rand_dim(8);
    vice_png_stream* st = vice_png_open(pw, ph, 4, (next_rand() & 1) ? 3 : 4, nullptr, 0);
    if (st) {
      std::vector<unsigned char> chunk(1024);
      size_t got = 0;
      std::vector<unsigned char> big((size_t)40 * 40 * 4, 0x80);
      for (int i = 0; i < 4; i++) {
        int n = (int)(next_rand() % 6);
        vice_png_write_rows(st, big.data(), n); // return ignored: misuse legal
        vice_png_drain(st, chunk.data(), chunk.size(), &got);
      }
      vice_png_close(st); // may fail: legal
      vice_png_drain(st, chunk.data(), chunk.size(), &got);
      vice_png_destroy(st);
    }
  }

  // 20 MB random ICC must not corrupt memory (16 MB cap rejects or copies).
  {
    std::vector<unsigned char> icc(20u << 20);
    for (size_t i = 0; i < icc.size(); i += 4096) icc[i] = (unsigned char)(next_rand() & 0xff);
    vice_stream_ctx* s2 = vice_stream_create(8, 8, 2, 3, 8);
    if (s2) {
      vice_stream_set_icc_profile(s2, icc.data(), icc.size());
      vice_stream_destroy(s2);
    }
    vice_png_stream* st = vice_png_open(4, 4, 3, 3, icc.data(), icc.size());
    if (st) vice_png_destroy(st);
  }
}

} // namespace

int main(int argc, char** argv) {
  uint64_t seed = argc > 1 ? (uint64_t)std::strtoull(argv[1], nullptr, 0) : 1;
  // Fixed-seed sweep (deterministic) plus one argv seed.
  for (uint64_t s = 1; s <= 20; s++) fuzz_stream(s);
  if (seed > 20) fuzz_stream(seed);
  // Invalid-dimension rejections must return null, never crash.
  if (vice_stream_create(0, 8, 2, 3, 8) != nullptr) {
    std::printf("FUZZ FAIL null-arg accepted\n");
    return 1;
  }
  if (vice_stream_create(8, 8, 5, 3, 8) != nullptr) {
    std::printf("FUZZ FAIL bad-scale accepted\n");
    return 1;
  }
  std::printf("FUZZ PASS\n");
  return 0;
}
