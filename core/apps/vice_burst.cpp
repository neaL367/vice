// vice_burst CLI: N PPM P6 (RGB) frames → PPM P6 out.
// Usage: vice_burst out.ppm scale in1.ppm in2.ppm ...
// Frame 0 is the reference; shifts are estimated + gated internally.
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>
#include "vice.h"

namespace {
bool read_ppm(const char* path, std::vector<unsigned char>& px, int& w, int& h) {
  FILE* f = fopen(path, "rb");
  if (!f) return false;
  auto next_token = [&](std::string& tok) {
    tok.clear();
    int c;
    do {
      c = fgetc(f);
      if (c == '#') { while (c != '\n' && c != EOF) c = fgetc(f); }
      if (c == EOF) return false;
    } while (c == ' ' || c == '\t' || c == '\n' || c == '\r');
    while (c != ' ' && c != '\t' && c != '\n' && c != '\r' && c != EOF) {
      tok.push_back((char)c);
      c = fgetc(f);
    }
    return true;
  };
  std::string magic, ws, hs, mx;
  if (!next_token(magic) || magic != "P6") { fclose(f); return false; }
  if (!next_token(ws) || !next_token(hs) || !next_token(mx)) { fclose(f); return false; }
  w = atoi(ws.c_str());
  h = atoi(hs.c_str());
  if (w <= 0 || h <= 0 || atoi(mx.c_str()) != 255) { fclose(f); return false; }
  px.resize((size_t)w * h * 3);
  bool ok = fread(px.data(), 1, px.size(), f) == px.size();
  fclose(f);
  return ok;
}

bool write_ppm(const char* path, const std::vector<unsigned char>& px, int w, int h) {
  FILE* f = fopen(path, "wb");
  if (!f) return false;
  fprintf(f, "P6\n%d %d\n255\n", w, h);
  bool ok = fwrite(px.data(), 1, px.size(), f) == px.size();
  fclose(f);
  return ok;
}
}  // namespace

int main(int argc, char** argv) {
  if (argc < 5) {
    std::fprintf(stderr, "usage: vice_burst out.ppm scale in1.ppm in2.ppm ...\n");
    return 2;
  }
  int s = atoi(argv[2]);
  std::vector<std::vector<unsigned char>> ins;
  int w = 0, h = 0;
  for (int k = 3; k < argc; k++) {
    std::vector<unsigned char> px;
    int kw = 0, kh = 0;
    if (!read_ppm(argv[k], px, kw, kh)) { std::fprintf(stderr, "bad input %s\n", argv[k]); return 1; }
    if (k == 3) {
      w = kw;
      h = kh;
    } else if (kw != w || kh != h) {
      std::fprintf(stderr, "frame size mismatch\n");
      return 1;
    }
    ins.push_back(std::move(px));
  }
  std::vector<const unsigned char*> ptrs;
  for (auto& px : ins) ptrs.push_back(px.data());
  std::vector<unsigned char> out((size_t)w * s * h * s * 3);
  if (vice_upscale_burst(ptrs.data(), (int)ptrs.size(), w, h, 3, s, out.data(), nullptr) != 0) {
    std::fprintf(stderr, "bad args\n");
    return 1;
  }
  if (!write_ppm(argv[1], out, w * s, h * s)) { std::fprintf(stderr, "bad output\n"); return 1; }
  std::fprintf(stderr, "residual=%.3e\n", vice_last_residual());
  return 0;
}
