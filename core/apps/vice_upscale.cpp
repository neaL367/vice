// vice_upscale CLI: PPM P6 (RGB) in → PPM P6 out. Usage: vice_upscale in.ppm scale out.ppm
// Validation bridge: TS harness exports PPM crops, scores C++ output PPMs.
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
  if (argc != 4) {
    std::fprintf(stderr, "usage: vice_upscale in.ppm scale out.ppm\n");
    return 2;
  }
  std::vector<unsigned char> in;
  int w = 0, h = 0;
  if (!read_ppm(argv[1], in, w, h)) { std::fprintf(stderr, "bad input\n"); return 1; }
  int s = atoi(argv[2]);
  std::vector<unsigned char> out((size_t)w * s * h * s * 3);
  // Scale 8 routes through hierarchical progressive staging (float64
  // intermediates, exact-sum quantization at final scale); 2/3/4 unchanged.
  int rc = (s == 8) ? vice_upscale_progressive(in.data(), w, h, 3, s, out.data())
                    : vice_upscale(in.data(), w, h, 3, s, out.data());
  if (rc != 0) { std::fprintf(stderr, "bad args\n"); return 1; }
  if (!write_ppm(argv[3], out, w * s, h * s)) { std::fprintf(stderr, "bad output\n"); return 1; }
  std::fprintf(stderr, "residual=%.3e\n", vice_last_residual());
  return 0;
}
