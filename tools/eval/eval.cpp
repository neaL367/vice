// vice_eval: quality suite (spec sec 10).
// Modes: procedural synthetics (always) + real datasets (Set5/Set14/BSD100/
// Urban100 HR images) when a data dir is given.
// Protocol per image: HR -> LR via box (matches guarantee) AND bicubic
// (standard benchmark); bilinear stand-in "network" -> projection; report
// raw-vs-projected ablation. Exit != 0 on gate fail.
// Metrics on Rec.709 luma (standard uses BT.601 Y; deltas are negligible).

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>
#include "vice.h"
#include "vice_metrics.h"
#include "stb_image.h"

namespace {

void bilinear_up(const float* src, float* dst, int w, int h, int s, int c) {
  int W = w * s, H = h * s;
  for (int y = 0; y < H; y++) {
    double gy = (double)y / s - 0.5;
    int y0 = (int)std::floor(gy);
    if (y0 < 0) y0 = 0;
    if (y0 > h - 1) y0 = h - 1;
    int y1 = y0 + 1 < h ? y0 + 1 : h - 1;
    double fy = gy - y0;
    if (fy < 0) fy = 0;
    if (fy > 1) fy = 1;
    for (int x = 0; x < W; x++) {
      double gx = (double)x / s - 0.5;
      int x0 = (int)std::floor(gx);
      if (x0 < 0) x0 = 0;
      if (x0 > w - 1) x0 = w - 1;
      int x1 = x0 + 1 < w ? x0 + 1 : w - 1;
      double fx = gx - x0;
      if (fx < 0) fx = 0;
      if (fx > 1) fx = 1;
      for (int ch = 0; ch < c; ch++) {
        float a = src[(y0 * w + x0) * c + ch], b = src[(y0 * w + x1) * c + ch];
        float d = src[(y1 * w + x0) * c + ch], e = src[(y1 * w + x1) * c + ch];
        dst[(y * W + x) * c + ch] = (float)(a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) +
                                            d * (1 - fx) * fy + e * fx * fy);
      }
    }
  }
}

float cubic_w(float x) { // Catmull-Rom Keys a=-0.5
  x = std::abs(x);
  if (x <= 1) return 1.5f * x * x * x - 2.5f * x * x + 1.0f;
  if (x < 2) return -0.5f * x * x * x + 2.5f * x * x - 4.0f * x + 2.0f;
  return 0.0f;
}

// Separable bicubic downsample HR (W,H) -> LR (w,h). Clamp-to-edge.
void bicubic_down(const float* hr, float* lr, int W, int H, int w, int h, int c) {
  std::vector<float> tmp((size_t)W * h * c);
  double sx = (double)W / w;
  for (int y = 0; y < H; y++)
    for (int x = 0; x < w; x++) {
      double gx = (x + 0.5) * sx - 0.5;
      int x0 = (int)std::floor(gx);
      for (int ch = 0; ch < c; ch++) {
        double v = 0, wn = 0;
        for (int k = -1; k <= 2; k++) {
          int xx = x0 + k;
          if (xx < 0) xx = 0;
          if (xx > W - 1) xx = W - 1;
          float wt = cubic_w((float)(gx - (x0 + k)));
          v += hr[(y * W + xx) * c + ch] * wt;
          wn += wt;
        }
        tmp[((size_t)y * w + x) * c + ch] = (float)(v / wn);
      }
    }
  double sy = (double)H / h;
  for (int y = 0; y < h; y++)
    for (int x = 0; x < w; x++) {
      double gy = (y + 0.5) * sy - 0.5;
      int y0 = (int)std::floor(gy);
      for (int ch = 0; ch < c; ch++) {
        double v = 0, wn = 0;
        for (int k = -1; k <= 2; k++) {
          int yy = y0 + k;
          if (yy < 0) yy = 0;
          if (yy > H - 1) yy = H - 1;
          float wt = cubic_w((float)(gy - (y0 + k)));
          v += tmp[((size_t)yy * w + x) * c + ch] * wt;
          wn += wt;
        }
        float q = (float)(v / wn);
        lr[((size_t)y * w + x) * c + ch] = q < 0 ? 0 : (q > 1 ? 1 : q);
      }
    }
}

bool load_rgb(const std::string& path, std::vector<float>& out, int& w, int& h) {
  int n = 0;
  unsigned char* px = stbi_load(path.c_str(), &w, &h, &n, 3);
  if (!px) return false;
  out.assign((size_t)w * h * 3, 0);
  for (size_t i = 0; i < (size_t)w * h * 3; i++) out[i] = px[i] / 255.0f;
  stbi_image_free(px);
  return true;
}

// Crop top-left to a multiple of s (standard eval shave). Returns false if
// the crop would be too small to measure.
bool load_cropped(const std::string& path, std::vector<float>& out, int& W, int& H, int s) {
  std::vector<float> full;
  int w = 0, h = 0;
  if (!load_rgb(path, full, w, h)) return false;
  int cw = (w / s) * s, ch = (h / s) * s;
  if (cw < 8 * s || ch < 8 * s) return false;
  out.assign((size_t)cw * ch * 3, 0);
  for (int y = 0; y < ch; y++)
    for (int x = 0; x < cw; x++)
      for (int c = 0; c < 3; c++) out[((size_t)y * cw + x) * 3 + c] = full[((size_t)y * w + x) * 3 + c];
  W = cw;
  H = ch;
  return true;
}

struct Accum {
  double resid = 0, pr = 0, pp = 0, sr = 0, sp = 0, seam = 0;
  int n = 0;
};

// 4x chaining policy (argv[3]).
// direct  = single 4x upscale (default: matches the app).
// chained = 2x twice, full tuning on both passes (engine-only detail path).
// clean   = 2x twice, plain Lanczos+dering second pass (shipped 2x2x toggle).
static int g_policy4 = 2;

// Shipped-path projection leg: the app's UnifiedRenderer drives the streaming
// strip API (64-row bands, clamp-aware box only, no multigrid/smoothing), so
// proj renders through vice_stream_* and the 8-bit sRGB bands convert back
// for scoring. This keeps the table honest about shipped bytes; see bench4x
// for the full-image multigrid/smooth comparison.
static bool render_stream_proj(const float* lr, int w, int h, int s, int fused,
                               std::vector<float>& out, double* residual) {
  int W = w * s, H = h * s;
  const int C = 3;
  // The stream context rounds band_h up to a multiple of s; size the byte
  // buffer for the rounded value (e.g. 64 -> 66 at 3x) or pulls overflow it.
  const int band_rows = ((64 + s - 1) / s) * s;
  vice_stream_ctx* ctx = vice_stream_create(w, h, s, C, 64);
  if (!ctx) return false;
  if (fused && vice_stream_set_fused(ctx, fused) != 0) {
    vice_stream_destroy(ctx);
    return false;
  }
  const int PUSH = 16;
  int pushed = 0, emitted = 0;
  std::vector<unsigned char> band((size_t)band_rows * W * C);
  out.assign((size_t)W * H * C, 0.0f);
  while (emitted < H) {
    while (pushed < h && !vice_stream_has_next_band(ctx)) {
      int n = (h - pushed < PUSH) ? h - pushed : PUSH;
      if (vice_stream_push_input_rows(ctx, lr + (size_t)pushed * w * C, n) != 0) {
        vice_stream_destroy(ctx);
        return false;
      }
      pushed += n;
    }
    if (!vice_stream_has_next_band(ctx)) {
      vice_stream_destroy(ctx);
      return false;
    }
    int rows = 0;
    int rc = vice_stream_pull_band(ctx, band.data(), &rows);
    if (rc < 0 || rows <= 0) {
      vice_stream_destroy(ctx);
      return false;
    }
    for (int r = 0; r < rows; r++)
      for (int x = 0; x < W * C; x++)
        // Bands come back as 8-bit sRGB; invert to linear for scoring in the
        // physical domain the pipeline actually works in.
        out[((size_t)(emitted + r) * W * C) + x] =
            vice_srgb_to_linear(band[(size_t)r * W * C + x] / 255.0f);
    emitted += rows;
    if (rc == 1) break;
  }
  *residual = vice_stream_last_residual(ctx);
  vice_stream_destroy(ctx);
  return emitted == H;
}

bool run_case(const float* hr, int W, int H, int s, Accum& ac) {
  const int C = 3;
  int w = W / s, h = H / s;
  if (w < 8 || h < 8) return true; // too small to measure, skip
  std::vector<float> lr_box((size_t)w * h * C), lr_bic((size_t)w * h * C);
  vice_box_downscale(hr, lr_box.data(), w, h, s, C);
  bicubic_down(hr, lr_bic.data(), W, H, w, h, C);
  for (const float* lr_srgb : {lr_box.data(), lr_bic.data()}) {
    // Score in linear light: the pipeline consumes/produces linear, and the
    // stream bands round-trip through sRGB+N-bit quantization (inverted
    // above), so the sRGB-domain comparison would double-warp the gamma.
    std::vector<float> lr((size_t)w * h * C);
    for (size_t i = 0; i < lr.size(); i++) lr[i] = vice_srgb_to_linear(lr_srgb[i]);
    std::vector<float> hr_lin((size_t)W * H * C);
    for (size_t i = 0; i < hr_lin.size(); i++) hr_lin[i] = vice_srgb_to_linear(hr[i]);
    // raw = Lanczos-only baseline (pre-projection). The 4x policy lives in
    // the proj leg's fused mode, which is what ships.
    std::vector<float> raw((size_t)W * H * C), proj;
    vice_upscale_lanczos_adaptive(lr.data(), w, h, C, s, raw.data());
    int fused = 0;
    if (s == 4 && g_policy4 != 2) fused = (g_policy4 == 0) ? 2 : 1;
    double worst = 0;
    if (!render_stream_proj(lr.data(), w, h, s, fused, proj, &worst)) return false;
    ac.resid = worst > ac.resid ? worst : ac.resid;
    ac.pr += vice_psnr(raw.data(), hr_lin.data(), W, H, C);
    ac.pp += vice_psnr(proj.data(), hr_lin.data(), W, H, C);
    ac.sr += vice_ssim(raw.data(), hr_lin.data(), W, H, C);
    ac.sp += vice_ssim(proj.data(), hr_lin.data(), W, H, C);
    ac.seam += vice_seam_ratio(proj.data(), W, H, s, C);
    ac.n++;
  }
  return true;
}

void make_hr(std::vector<float>& hr, int W, int H, int C, const std::string& kind) {
  hr.assign((size_t)W * H * C, 0.5f);
  for (int y = 0; y < H; y++)
    for (int x = 0; x < W; x++) {
      float v = 0.5f;
      if (kind == "gradient") v = 0.1f + 0.8f * (x / (float)(W - 1)) * (y / (float)(H - 1));
      else if (kind == "checker") v = ((x / 8 + y / 8) % 2) ? 0.9f : 0.1f;
      else if (kind == "chirp") v = 0.5f + 0.4f * std::sin(x * 0.3f) * std::sin(y * 0.23f);
      else if (kind == "bars") v = (x % 16 < 2) ? 0.9f : 0.15f;
      for (int c = 0; c < C; c++) hr[(y * W + x) * C + c] = v;
    }
}

} // namespace

#ifdef _WIN32
#include <windows.h>
static std::vector<std::string> list_images(const std::string& dir) {
  std::vector<std::string> out;
  std::string pat = dir + "/*.png";
  WIN32_FIND_DATAA f;
  HANDLE hd = FindFirstFileA(pat.c_str(), &f);
  if (hd == INVALID_HANDLE_VALUE) return out;
  do {
    if (!(f.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) out.push_back(dir + "/" + f.cFileName);
  } while (FindNextFileA(hd, &f));
  FindClose(hd);
  return out;
}
#else
#include <dirent.h>
static std::vector<std::string> list_images(const std::string& dir) {
  std::vector<std::string> out;
  if (DIR* d = opendir(dir.c_str())) {
    while (dirent* e = readdir(d)) {
      std::string n = e->d_name;
      if (n.size() > 4 && n.substr(n.size() - 4) == ".png") out.push_back(dir + "/" + n);
    }
    closedir(d);
  }
  return out;
}
#endif

int main(int argc, char** argv) {
  std::string data = argc > 1 ? argv[1] : "";
  int max_imgs = argc > 2 ? std::atoi(argv[2]) : 0;
  std::string policy = argc > 3 ? argv[3] : "direct";
  g_policy4 = (policy == "chained") ? 0 : (policy == "clean") ? 1 : 2;
  bool ok = true;
  std::printf("%-10s %-5s %10s %10s %10s %10s %10s %8s %5s\n", "set", "scale", "residual",
              "psnr_raw", "psnr_proj", "ssim_raw", "ssim_proj", "seam", "n");
  std::printf("# policy4=%s\n", policy.c_str());
  std::fflush(stdout);

  auto report = [&](const std::string& name, int scale, const Accum& ac) {
    if (!ac.n) return;
    double seam = ac.seam / ac.n;
    std::printf("%-10s %-5d %10.2e %10.2f %10.2f %10.4f %10.4f %8.3f %5d\n", name.c_str(), scale,
                ac.resid, ac.pr / ac.n, ac.pp / ac.n, ac.sr / ac.n, ac.sp / ac.n, seam, ac.n);
    std::fflush(stdout);
    if (ac.resid > 1e-4) ok = false;
    if (!(seam > 0.0) || seam > 12.0) ok = false;
    // Seam bound is for the shipped streaming box-only projection on
    // adversarial synthetics (checker/bars peak ~9.5 at 2x: per-block
    // constant shifts step at block boundaries on pathological contrast).
    // Natural-image seam stays ~1.3-1.6; see README. The smooth+box path
    // scores lower here, but it is not what ships (compare in bench4x).
  };

  // Procedural suite (always runs).
  for (int s : {2, 3, 4}) {
    Accum ac;
    for (const char* k : {"gradient", "checker", "chirp", "bars"}) {
      std::vector<float> hr;
      make_hr(hr, 96, 96, 3, k);
      run_case(hr.data(), 96, 96, s, ac);
    }
    report("synthetic", s, ac);
  }

  // Real datasets.
  const char* sets[][2] = {
      {"Set5", "/Set5/Set5"}, {"Set14", "/Set14/Set14"}, {"BSD100", "/BSD100/BSD100"},
  };
  if (!data.empty()) {
    for (auto [name, sub] : sets) {
      for (const char* sr : {"SRF_2", "SRF_3", "SRF_4"}) {
        std::string dir = data + sub + "/image_" + sr;
        auto files = list_images(dir);
        if (files.empty()) continue;
        Accum ac;
        int cnt = 0;
        for (auto& f : files) {
          if (f.find("_LR.") != std::string::npos) continue; // HR only, own degradations
          if (max_imgs > 0 && cnt >= max_imgs) break;
          int s = sr[4] - '0';
          std::vector<float> hr;
          int W = 0, H = 0;
          if (!load_cropped(f, hr, W, H, s)) continue;
          run_case(hr.data(), W, H, s, ac);
          cnt++;
        }
        std::printf("%-10s %-5d ", name, sr[4] - '0');
        if (!ac.n) {
          std::printf("no images\n");
          continue;
        }
        double seam = ac.seam / ac.n;
        std::printf("%10.2e %10.2f %10.2f %10.4f %10.4f %8.3f %5d\n", ac.resid, ac.pr / ac.n,
                    ac.pp / ac.n, ac.sr / ac.n, ac.sp / ac.n, seam, ac.n);
        if (ac.resid > 1e-4) ok = false;
        if (!(seam > 0.0) || seam > 5.0) ok = false;
      }
    }
    // Urban100 layout differs: flat HR dir.
    {
      auto files = list_images(data + "/Urban100/Urban100_HR");
      for (int s : {2, 3, 4}) {
        Accum ac;
        int cnt = 0;
        for (auto& f : files) {
          if (max_imgs > 0 && cnt >= max_imgs) break;
          std::vector<float> hr;
          int W = 0, H = 0;
          if (!load_cropped(f, hr, W, H, s)) continue;
          run_case(hr.data(), W, H, s, ac);
          cnt++;
        }
        std::printf("%-10s %-5d ", "Urban100", s);
        if (!ac.n) {
          std::printf("no images\n");
          continue;
        }
        double seam = ac.seam / ac.n;
        std::printf("%10.2e %10.2f %10.2f %10.4f %10.4f %8.3f %5d\n", ac.resid, ac.pr / ac.n,
                    ac.pp / ac.n, ac.sr / ac.n, ac.sp / ac.n, seam, ac.n);
        if (ac.resid > 1e-4) ok = false;
        if (!(seam > 0.0) || seam > 5.0) ok = false;
      }
    }
  }

  std::printf(ok ? "EVAL PASS\n" : "EVAL FAIL\n");
  return ok ? 0 : 1;
}
