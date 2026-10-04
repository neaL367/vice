// vice_lab: research tool for a engine beyond Lanczos-3.
//
//   vice_lab tune  <data>          coordinate-search the heuristic constants (tuning.txt)
//   vice_lab train <data>          learn edge-adaptive luma filters per scale (model_x*.bin)
//   vice_lab eval  <data> [max]    compare shipped / tuned / smooth-projection / learned
//
// Splits (no leakage):  train = BSD100[0..79]   validation = BSD100[80..99]
//                       test  = Set5, Set14, Urban100
//
// Learned engine ("Vice-L"): the tuned Lanczos result is refined on luma only by a
// linear filter chosen per (sub-pixel phase, gradient angle, strength, coherence)
// bucket. Filters are ridge-regressed toward "no change" on box-degraded pairs, so
// they are trained for the same operator the consistency projection uses. Chroma is
// left to the base engine (luma/chroma split). The box projection runs last, so the
// output is still exactly consistent with the input.

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <thread>
#include <vector>

#include "stb_image.h"
#include "vice.h"
#include "vice_metrics.h"

namespace fs = std::filesystem;

namespace {

constexpr double kPi = 3.14159265358979323846;

// ---------------------------------------------------------------- utilities

template <class F>
void parallel_for(int n, F fn) {
  int nt = (int)std::thread::hardware_concurrency();
  if (nt < 1) nt = 1;
  if (nt > 8) nt = 8;
  if (nt > n) nt = n > 0 ? n : 1;
  std::atomic<int> next{0};
  std::vector<std::thread> th;
  for (int t = 0; t < nt; t++)
    th.emplace_back([&, t] {
      for (;;) {
        int i = next++;
        if (i >= n) break;
        fn(i, t);
      }
    });
  for (auto& x : th) x.join();
  (void)nt;
}

int num_threads() {
  int nt = (int)std::thread::hardware_concurrency();
  return nt < 1 ? 1 : (nt > 8 ? 8 : nt);
}

struct Img {
  int w = 0, h = 0;
  std::vector<float> px; // RGB interleaved, [0,1]
};

bool load_hr(const std::string& path, int s, Img& out) {
  int w = 0, h = 0, n = 0;
  unsigned char* p = stbi_load(path.c_str(), &w, &h, &n, 3);
  if (!p) return false;
  int cw = (w / s) * s, ch = (h / s) * s;
  if (cw < 8 * s || ch < 8 * s) {
    stbi_image_free(p);
    return false;
  }
  out.w = cw;
  out.h = ch;
  out.px.assign((size_t)cw * ch * 3, 0.f);
  for (int y = 0; y < ch; y++)
    for (int x = 0; x < cw; x++)
      for (int c = 0; c < 3; c++)
        out.px[((size_t)y * cw + x) * 3 + c] = p[((size_t)y * w + x) * 3 + c] / 255.0f;
  stbi_image_free(p);
  return true;
}

std::vector<std::string> list_hr(const std::string& dir) {
  std::vector<std::string> v;
  std::error_code ec;
  if (!fs::exists(dir, ec)) return v;
  for (auto& e : fs::directory_iterator(dir, ec)) {
    if (!e.is_regular_file()) continue;
    std::string n = e.path().filename().string();
    if (n.size() < 5 || n.substr(n.size() - 4) != ".png") continue;
    if (n.find("_LR") != std::string::npos) continue;
    v.push_back(e.path().generic_string());
  }
  std::sort(v.begin(), v.end());
  return v;
}

std::vector<float> luma(const std::vector<float>& rgb) {
  size_t n = rgb.size() / 3;
  std::vector<float> y(n);
  for (size_t i = 0; i < n; i++)
    y[i] = 0.2126f * rgb[i * 3] + 0.7152f * rgb[i * 3 + 1] + 0.0722f * rgb[i * 3 + 2];
  return y;
}

float cubic_w(float x) {
  x = std::abs(x);
  if (x <= 1) return 1.5f * x * x * x - 2.5f * x * x + 1.0f;
  if (x < 2) return -0.5f * x * x * x + 2.5f * x * x - 4.0f * x + 2.0f;
  return 0.0f;
}

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
          int xx = std::clamp(x0 + k, 0, W - 1);
          float wt = cubic_w((float)(gx - (x0 + k)));
          v += hr[((size_t)y * W + xx) * c + ch] * wt;
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
          int yy = std::clamp(y0 + k, 0, H - 1);
          float wt = cubic_w((float)(gy - (y0 + k)));
          v += tmp[((size_t)yy * w + x) * c + ch] * wt;
          wn += wt;
        }
        lr[((size_t)y * w + x) * c + ch] = std::clamp((float)(v / wn), 0.0f, 1.0f);
      }
    }
}

// ---------------------------------------------------------------- projections

// Same as the shipped vice_project: box projection, clamp, up to 3 rounds.
void project_box_clamped(const float* lr, float* raw, int w, int h, int s) {
  const size_t n = (size_t)w * s * h * s * 3;
  for (int it = 0; it < 3; it++) {
    vice_project_box(lr, raw, w, h, s, 3);
    bool oob = false;
    for (size_t i = 0; i < n; i++)
      if (raw[i] < 0.f || raw[i] > 1.f) {
        oob = true;
        raw[i] = std::clamp(raw[i], 0.f, 1.f);
      }
    if (!oob) break;
  }
}

// Smooth back-projection: spread the block-mean error with a bilinear kernel (no
// block-constant steps), then finish with the exact box projection so the result
// is still consistent. Removes most of the per-block offset that causes seams.
void project_smooth(const float* lr, float* raw, int w, int h, int s) {
  const int W = w * s, H = h * s;
  std::vector<float> d((size_t)w * h * 3);
  for (int iter = 0; iter < 2; iter++) {
    vice_box_downscale(raw, d.data(), w, h, s, 3);
    for (size_t i = 0; i < d.size(); i++) d[i] = lr[i] - d[i];
    for (int y = 0; y < H; y++) {
      double gy = ((double)y + 0.5) / s - 0.5;
      int y0 = (int)std::floor(gy);
      double fy = gy - y0;
      int ya = std::clamp(y0, 0, h - 1), yb = std::clamp(y0 + 1, 0, h - 1);
      for (int x = 0; x < W; x++) {
        double gx = ((double)x + 0.5) / s - 0.5;
        int x0 = (int)std::floor(gx);
        double fx = gx - x0;
        int xa = std::clamp(x0, 0, w - 1), xb = std::clamp(x0 + 1, 0, w - 1);
        for (int c = 0; c < 3; c++) {
          double v = d[((size_t)ya * w + xa) * 3 + c] * (1 - fx) * (1 - fy) +
                     d[((size_t)ya * w + xb) * 3 + c] * fx * (1 - fy) +
                     d[((size_t)yb * w + xa) * 3 + c] * (1 - fx) * fy +
                     d[((size_t)yb * w + xb) * 3 + c] * fx * fy;
          float& r = raw[((size_t)y * W + x) * 3 + c];
          r = std::clamp(r + (float)v, 0.f, 1.f);
        }
      }
    }
  }
  project_box_clamped(lr, raw, w, h, s);
}

// ---------------------------------------------------------------- learned model

constexpr int kP = 7, kR = 3;       // patch size / radius
constexpr int kNIn = kP * kP - 1;   // centre excluded (predicted as a delta)
constexpr int kNA = 16, kNS = 3, kNC = 3;
constexpr int kNB = kNA * kNS * kNC;

struct Offset {
  int dx, dy;
};
std::vector<Offset> make_offsets() {
  std::vector<Offset> o;
  for (int dy = -kR; dy <= kR; dy++)
    for (int dx = -kR; dx <= kR; dx++)
      if (dx || dy) o.push_back({dx, dy});
  return o;
}
const std::vector<Offset> kOff = make_offsets();

struct Model {
  int s = 0;
  std::vector<float> f;       // [(phase * kNB + bucket) * kNIn + i]
  std::vector<uint8_t> valid; // per (phase, bucket)
  bool ok() const { return s > 0 && !f.empty(); }
};

void box5(std::vector<float>& v, int W, int H) {
  std::vector<float> t(v.size());
  for (int y = 0; y < H; y++)
    for (int x = 0; x < W; x++) {
      float a = 0;
      for (int k = -2; k <= 2; k++) a += v[(size_t)y * W + std::clamp(x + k, 0, W - 1)];
      t[(size_t)y * W + x] = a * 0.2f;
    }
  for (int y = 0; y < H; y++)
    for (int x = 0; x < W; x++) {
      float a = 0;
      for (int k = -2; k <= 2; k++) a += t[(size_t)std::clamp(y + k, 0, H - 1) * W + x];
      v[(size_t)y * W + x] = a * 0.2f;
    }
}

void compute_buckets(const std::vector<float>& Y, int W, int H, int s, std::vector<uint16_t>& bk) {
  const size_t n = (size_t)W * H;
  std::vector<float> gxx(n), gxy(n), gyy(n);
  for (int y = 0; y < H; y++)
    for (int x = 0; x < W; x++) {
      float gx = (Y[(size_t)y * W + std::min(x + 1, W - 1)] - Y[(size_t)y * W + std::max(x - 1, 0)]) *
                 0.5f * (float)s;
      float gy = (Y[(size_t)std::min(y + 1, H - 1) * W + x] - Y[(size_t)std::max(y - 1, 0) * W + x]) *
                 0.5f * (float)s;
      size_t i = (size_t)y * W + x;
      gxx[i] = gx * gx;
      gxy[i] = gx * gy;
      gyy[i] = gy * gy;
    }
  box5(gxx, W, H);
  box5(gxy, W, H);
  box5(gyy, W, H);
  bk.resize(n);
  for (size_t i = 0; i < n; i++) {
    float a = gxx[i], b = gxy[i], c = gyy[i];
    float r = std::sqrt((a - c) * (a - c) + 4 * b * b);
    float l1 = std::max(0.f, 0.5f * (a + c + r)), l2 = std::max(0.f, 0.5f * (a + c - r));
    float s1 = std::sqrt(l1), s2 = std::sqrt(l2);
    float theta = 0.5f * std::atan2(2 * b, a - c); // [-pi/2, pi/2]
    int ai = (int)((theta + (float)(kPi / 2)) / (float)kPi * kNA);
    ai = std::clamp(ai, 0, kNA - 1);
    int si = s1 < 0.02f ? 0 : (s1 < 0.06f ? 1 : 2);
    float coh = (s1 - s2) / (s1 + s2 + 1e-6f);
    int ci = coh < 0.3f ? 0 : (coh < 0.65f ? 1 : 2);
    bk[i] = (uint16_t)((ai * kNS + si) * kNC + ci);
  }
}

inline float at(const std::vector<float>& Y, int W, int H, int x, int y) {
  return Y[(size_t)std::clamp(y, 0, H - 1) * W + std::clamp(x, 0, W - 1)];
}

// Applies the learned luma correction to an RGB image (adds dY to every channel,
// which leaves chroma untouched).
void apply_learned(const Model& m, std::vector<float>& rgb, int W, int H) {
  const int s = m.s;
  std::vector<float> Y = luma(rgb);
  std::vector<uint16_t> bk;
  compute_buckets(Y, W, H, s, bk);
  float p[kNIn];
  for (int y = 0; y < H; y++)
    for (int x = 0; x < W; x++) {
      size_t i = (size_t)y * W + x;
      int f = ((y % s) * s + (x % s)) * kNB + bk[i];
      if (!m.valid[f]) continue;
      float c0 = Y[i];
      for (int k = 0; k < kNIn; k++) p[k] = at(Y, W, H, x + kOff[k].dx, y + kOff[k].dy) - c0;
      const float* h = &m.f[(size_t)f * kNIn];
      float dy = 0;
      for (int k = 0; k < kNIn; k++) dy += h[k] * p[k];
      for (int c = 0; c < 3; c++) rgb[i * 3 + c] = std::clamp(rgb[i * 3 + c] + dy, 0.f, 1.f);
    }
}

bool save_model(const Model& m, const std::string& path) {
  std::ofstream o(path, std::ios::binary);
  if (!o) return false;
  int32_t hdr[5] = {0x56494345, m.s, kNB, kNIn, (int32_t)m.valid.size()};
  o.write((const char*)hdr, sizeof(hdr));
  o.write((const char*)m.valid.data(), (std::streamsize)m.valid.size());
  o.write((const char*)m.f.data(), (std::streamsize)(m.f.size() * sizeof(float)));
  return (bool)o;
}

bool load_model(Model& m, const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return false;
  int32_t hdr[5];
  in.read((char*)hdr, sizeof(hdr));
  if (!in || hdr[0] != 0x56494345 || hdr[2] != kNB || hdr[3] != kNIn) return false;
  m.s = hdr[1];
  m.valid.assign((size_t)hdr[4], 0);
  m.f.assign((size_t)hdr[4] * kNIn, 0.f);
  in.read((char*)m.valid.data(), hdr[4]);
  in.read((char*)m.f.data(), (std::streamsize)(m.f.size() * sizeof(float)));
  return (bool)in;
}

// ---------------------------------------------------------------- pipelines

struct Paths {
  std::string out_dir;
};

bool load_tuning(const std::string& path, ViceTuning& t) {
  vice_tuning_defaults(&t);
  std::ifstream in(path);
  if (!in) return false;
  // Legacy tuning.txt holds the 6 heuristic constants; newer files append
  // dering sharpness preset shock. Missing tail keeps shipped defaults.
  float v[10];
  int n = 0;
  for (float& x : v) {
    if (!(in >> x)) break;
    ++n;
  }
  if (n < 6) return false;
  t.noise_floor = v[0];
  t.boost = v[1];
  t.boost_slope = v[2];
  t.wide_weight = v[3];
  t.steer_thresh = v[4];
  t.steer_weight = v[5];
  if (n > 6) t.dering = v[6];
  if (n > 7) t.sharpness = v[7];
  if (n > 8) t.preset = (int)v[8];
  if (n > 9) t.shock = v[9];
  return true;
}

void save_tuning(const std::string& path, const ViceTuning& t) {
  std::ofstream o(path);
  o << t.noise_floor << " " << t.boost << " " << t.boost_slope << " " << t.wide_weight << " "
    << t.steer_thresh << " " << t.steer_weight << " " << t.dering << " " << t.sharpness << " "
    << t.preset << " " << t.shock << "\n";
}

enum Method { kShipped, kTuned, kTunedSmooth, kLearned, kLearnedSmooth, kNumMethods };
const char* kMethodName[kNumMethods] = {"shipped", "tuned", "tuned+smooth", "learned",
                                        "learned+smooth"};

std::vector<float> run_method(Method m, const std::vector<float>& lr, int w, int h, int s,
                              const ViceTuning& tuned, const Model* model) {
  const int W = w * s, H = h * s;
  std::vector<float> out((size_t)W * H * 3);
  if (m == kShipped) {
    vice_upscale_lanczos_adaptive(lr.data(), w, h, 3, s, out.data());
    project_box_clamped(lr.data(), out.data(), w, h, s);
    return out;
  }
  vice_upscale_lanczos_adaptive_ex(lr.data(), w, h, 3, s, out.data(), &tuned);
  if ((m == kLearned || m == kLearnedSmooth) && model && model->ok()) apply_learned(*model, out, W, H);
  if (m == kTuned || m == kLearned)
    project_box_clamped(lr.data(), out.data(), w, h, s);
  else
    project_smooth(lr.data(), out.data(), w, h, s);
  return out;
}

// ---------------------------------------------------------------- metrics

struct M {
  double resid = 0, psnr = 0, ssim = 0, sharp = 0, ring = 0, seam = 0;
};

double mean_grad(const std::vector<float>& Y, int W, int H) {
  double a = 0;
  for (int y = 0; y + 1 < H; y++)
    for (int x = 0; x + 1 < W; x++) {
      float gx = Y[(size_t)y * W + x + 1] - Y[(size_t)y * W + x];
      float gy = Y[(size_t)(y + 1) * W + x] - Y[(size_t)y * W + x];
      a += std::sqrt(gx * gx + gy * gy);
    }
  return a / ((double)(W - 1) * (H - 1));
}

void env_minmax(const std::vector<float>& Y, int W, int H, std::vector<float>& mn,
                std::vector<float>& mx) {
  std::vector<float> tmn(Y.size()), tmx(Y.size());
  for (int y = 0; y < H; y++)
    for (int x = 0; x < W; x++) {
      float a = 1e9f, b = -1e9f;
      for (int k = -2; k <= 2; k++) {
        float v = Y[(size_t)y * W + std::clamp(x + k, 0, W - 1)];
        a = std::min(a, v);
        b = std::max(b, v);
      }
      tmn[(size_t)y * W + x] = a;
      tmx[(size_t)y * W + x] = b;
    }
  mn.resize(Y.size());
  mx.resize(Y.size());
  for (int y = 0; y < H; y++)
    for (int x = 0; x < W; x++) {
      float a = 1e9f, b = -1e9f;
      for (int k = -2; k <= 2; k++) {
        size_t j = (size_t)std::clamp(y + k, 0, H - 1) * W + x;
        a = std::min(a, tmn[j]);
        b = std::max(b, tmx[j]);
      }
      mn[(size_t)y * W + x] = a;
      mx[(size_t)y * W + x] = b;
    }
}

struct RefStats {
  std::vector<float> Y, mn, mx;
  double grad = 0;
};

RefStats make_ref(const Img& hr) {
  RefStats r;
  r.Y = luma(hr.px);
  env_minmax(r.Y, hr.w, hr.h, r.mn, r.mx);
  r.grad = mean_grad(r.Y, hr.w, hr.h);
  return r;
}

M measure(const std::vector<float>& out, const std::vector<float>& lr, const Img& hr,
          const RefStats& ref, int s) {
  const int W = hr.w, H = hr.h, w = W / s, h = H / s;
  M m;
  std::vector<float> back((size_t)w * h * 3);
  vice_box_downscale(out.data(), back.data(), w, h, s, 3);
  for (size_t i = 0; i < back.size(); i++) m.resid = std::max(m.resid, (double)std::abs(back[i] - lr[i]));
  m.psnr = vice_psnr(out.data(), hr.px.data(), W, H, 3);
  m.ssim = vice_ssim(out.data(), hr.px.data(), W, H, 3);
  m.seam = vice_seam_ratio(out.data(), W, H, s, 3);
  std::vector<float> Y = luma(out);
  m.sharp = mean_grad(Y, W, H) / (ref.grad > 1e-9 ? ref.grad : 1e-9);
  double ring = 0;
  for (size_t i = 0; i < Y.size(); i++)
    ring += std::max(0.f, Y[i] - ref.mx[i]) + std::max(0.f, ref.mn[i] - Y[i]);
  m.ring = 1000.0 * ring / (double)Y.size();
  return m;
}

// ---------------------------------------------------------------- tune

double objective(const std::vector<std::string>& files, const ViceTuning& t) {
  const int scales[3] = {2, 3, 4};
  std::vector<double> score(files.size() * 3, 0.0);
  parallel_for((int)(files.size() * 3), [&](int idx, int) {
    int fi = idx / 3, s = scales[idx % 3];
    Img hr;
    if (!load_hr(files[(size_t)fi], s, hr)) return;
    int w = hr.w / s, h = hr.h / s;
    std::vector<float> lr((size_t)w * h * 3);
    vice_box_downscale(hr.px.data(), lr.data(), w, h, s, 3);
    std::vector<float> out((size_t)hr.w * hr.h * 3);
    vice_upscale_lanczos_adaptive_ex(lr.data(), w, h, 3, s, out.data(), &t);
    project_box_clamped(lr.data(), out.data(), w, h, s);
    score[(size_t)idx] = vice_psnr(out.data(), hr.px.data(), hr.w, hr.h, 3) +
                         10.0 * vice_ssim(out.data(), hr.px.data(), hr.w, hr.h, 3);
  });
  double a = 0;
  for (double v : score) a += v;
  return a / (double)score.size();
}

int cmd_tune(const std::string& data, const std::string& out_dir) {
  auto all = list_hr(data + "/BSD100/BSD100/image_SRF_2");
  if (all.size() < 20) {
    std::fprintf(stderr, "need BSD100 under %s\n", data.c_str());
    return 1;
  }
  std::vector<std::string> train(all.begin(), all.begin() + 12);
  ViceTuning t;
  vice_tuning_defaults(&t);
  double best = objective(train, t);
  std::printf("start  score=%.4f\n", best);
  float* P[6] = {&t.noise_floor, &t.boost, &t.boost_slope, &t.wide_weight, &t.steer_thresh,
                 &t.steer_weight};
  const char* names[6] = {"noise_floor", "boost", "boost_slope", "wide_weight", "steer_thresh",
                          "steer_weight"};
  const float lo[6] = {0.001f, 0.0f, 1.0f, 0.0f, 0.02f, 0.0f};
  const float hi[6] = {0.05f, 1.5f, 24.0f, 1.0f, 0.8f, 0.9f};
  const float factors[3] = {1.6f, 1.25f, 1.1f};
  for (int round = 0; round < 3; round++) {
    bool improved = false;
    for (int k = 0; k < 6; k++) {
      float orig = *P[k];
      float cands[4] = {orig / factors[round], orig * factors[round], orig == 0.f ? 0.05f : orig * 0.2f,
                        orig == 0.f ? 0.15f : orig * 0.6f};
      float bestv = orig;
      for (float c : cands) {
        c = std::clamp(c, lo[k], hi[k]);
        if (c == orig) continue;
        *P[k] = c;
        double sc = objective(train, t);
        if (sc > best + 1e-5) {
          best = sc;
          bestv = c;
          improved = true;
        }
      }
      *P[k] = bestv;
      std::printf("round %d  %-13s = %.4f   score=%.4f\n", round, names[k], bestv, best);
      std::fflush(stdout);
    }
    if (!improved) break;
  }
  fs::create_directories(out_dir);
  save_tuning(out_dir + "/tuning.txt", t);
  std::printf("saved %s/tuning.txt  final score=%.4f\n", out_dir.c_str(), best);
  return 0;
}

// ---------------------------------------------------------------- train

struct Acc {
  std::vector<double> ata, atb;
  std::vector<uint32_t> cnt;
  void init(int s) {
    size_t nf = (size_t)s * s * kNB;
    ata.assign(nf * kNIn * kNIn, 0.0);
    atb.assign(nf * kNIn, 0.0);
    cnt.assign(nf, 0);
  }
};

void accumulate(Acc& acc, const std::vector<float>& base_rgb, const Img& hr, int s) {
  const int W = hr.w, H = hr.h;
  std::vector<float> Yb = luma(base_rgb), Yh = luma(hr.px);
  std::vector<uint16_t> bk;
  compute_buckets(Yb, W, H, s, bk);
  double p[kNIn];
  for (int y = 0; y < H; y++)
    for (int x = 0; x < W; x++) {
      unsigned hsh = ((unsigned)x * 73856093u) ^ ((unsigned)y * 19349663u);
      if (hsh & 1u) continue; // random half of the pixels
      size_t i = (size_t)y * W + x;
      size_t f = (size_t)(((y % s) * s + (x % s)) * kNB + bk[i]);
      double c0 = Yb[i];
      for (int k = 0; k < kNIn; k++) p[k] = at(Yb, W, H, x + kOff[k].dx, y + kOff[k].dy) - c0;
      double t = (double)Yh[i] - c0;
      double* A = &acc.ata[f * kNIn * kNIn];
      double* B = &acc.atb[f * kNIn];
      for (int a = 0; a < kNIn; a++) {
        double pa = p[a];
        double* row = A + a * kNIn;
        for (int b = a; b < kNIn; b++) row[b] += pa * p[b];
        B[a] += pa * t;
      }
      acc.cnt[f]++;
    }
}

bool solve_spd(std::vector<double>& A, std::vector<double>& b, int n) {
  for (int i = 0; i < n; i++)
    for (int j = 0; j <= i; j++) {
      double sum = A[(size_t)i * n + j];
      for (int k = 0; k < j; k++) sum -= A[(size_t)i * n + k] * A[(size_t)j * n + k];
      if (i == j) {
        if (sum <= 1e-14) return false;
        A[(size_t)i * n + i] = std::sqrt(sum);
      } else {
        A[(size_t)i * n + j] = sum / A[(size_t)j * n + j];
      }
    }
  for (int i = 0; i < n; i++) {
    double sum = b[(size_t)i];
    for (int k = 0; k < i; k++) sum -= A[(size_t)i * n + k] * b[(size_t)k];
    b[(size_t)i] = sum / A[(size_t)i * n + i];
  }
  for (int i = n - 1; i >= 0; i--) {
    double sum = b[(size_t)i];
    for (int k = i + 1; k < n; k++) sum -= A[(size_t)k * n + i] * b[(size_t)k];
    b[(size_t)i] = sum / A[(size_t)i * n + i];
  }
  return true;
}

Model solve_model(const Acc& acc, int s, double lambda_rel) {
  Model m;
  m.s = s;
  size_t nf = (size_t)s * s * kNB;
  m.f.assign(nf * kNIn, 0.f);
  m.valid.assign(nf, 0);
  parallel_for((int)nf, [&](int fi, int) {
    size_t f = (size_t)fi;
    if (acc.cnt[f] < 300) return;
    std::vector<double> A((size_t)kNIn * kNIn), b(kNIn);
    double tr = 0;
    for (int i = 0; i < kNIn; i++)
      for (int j = i; j < kNIn; j++) {
        double v = acc.ata[f * kNIn * kNIn + (size_t)i * kNIn + j];
        A[(size_t)i * kNIn + j] = v;
        A[(size_t)j * kNIn + i] = v;
        if (i == j) tr += v;
      }
    double lam = lambda_rel * tr / kNIn + 1e-9;
    for (int i = 0; i < kNIn; i++) {
      A[(size_t)i * kNIn + i] += lam;
      b[(size_t)i] = acc.atb[f * kNIn + (size_t)i];
    }
    if (!solve_spd(A, b, kNIn)) return;
    for (int i = 0; i < kNIn; i++) m.f[f * kNIn + (size_t)i] = (float)b[(size_t)i];
    m.valid[f] = 1;
  });
  return m;
}

double validate(const Model& m, const std::vector<std::string>& files, const ViceTuning& t, int s) {
  std::vector<double> sc(files.size(), 0.0);
  parallel_for((int)files.size(), [&](int i, int) {
    Img hr;
    if (!load_hr(files[(size_t)i], s, hr)) return;
    int w = hr.w / s, h = hr.h / s;
    std::vector<float> lr((size_t)w * h * 3);
    vice_box_downscale(hr.px.data(), lr.data(), w, h, s, 3);
    auto out = run_method(kLearned, lr, w, h, s, t, &m);
    sc[(size_t)i] = vice_psnr(out.data(), hr.px.data(), hr.w, hr.h, 3);
  });
  double a = 0;
  for (double v : sc) a += v;
  return a / (double)sc.size();
}

int cmd_train(const std::string& data, const std::string& out_dir) {
  auto all = list_hr(data + "/BSD100/BSD100/image_SRF_2");
  if (all.size() < 100) {
    std::fprintf(stderr, "need 100 BSD100 images under %s\n", data.c_str());
    return 1;
  }
  std::vector<std::string> train(all.begin(), all.begin() + 80), val(all.begin() + 80, all.begin() + 100);
  ViceTuning t;
  vice_tuning_defaults(&t);
  if (load_tuning(out_dir + "/tuning.txt", t)) std::printf("using tuned base engine\n");
  fs::create_directories(out_dir);

  for (int s : {2, 3, 4}) {
    int nt = num_threads();
    std::vector<Acc> accs((size_t)nt);
    for (auto& a : accs) a.init(s);
    parallel_for((int)train.size(), [&](int i, int tid) {
      Img hr;
      if (!load_hr(train[(size_t)i], s, hr)) return;
      int w = hr.w / s, h = hr.h / s;
      std::vector<float> lr((size_t)w * h * 3);
      vice_box_downscale(hr.px.data(), lr.data(), w, h, s, 3);
      std::vector<float> base((size_t)hr.w * hr.h * 3);
      vice_upscale_lanczos_adaptive_ex(lr.data(), w, h, 3, s, base.data(), &t);
      accumulate(accs[(size_t)tid], base, hr, s);
    });
    Acc& total = accs[0];
    for (int k = 1; k < nt; k++) {
      for (size_t i = 0; i < total.ata.size(); i++) total.ata[i] += accs[(size_t)k].ata[i];
      for (size_t i = 0; i < total.atb.size(); i++) total.atb[i] += accs[(size_t)k].atb[i];
      for (size_t i = 0; i < total.cnt.size(); i++) total.cnt[i] += accs[(size_t)k].cnt[i];
      accs[(size_t)k] = Acc();
    }
    // baseline: no learned filters
    Model none;
    none.s = s;
    none.f.assign((size_t)s * s * kNB * kNIn, 0.f);
    none.valid.assign((size_t)s * s * kNB, 0);
    double base_psnr = validate(none, val, t, s);
    double best_psnr = -1, best_lam = 0;
    Model best;
    for (double lam : {3e-4, 1e-3, 3e-3, 1e-2, 3e-2, 1e-1}) {
      Model m = solve_model(total, s, lam);
      double p = validate(m, val, t, s);
      std::printf("x%d  lambda=%.0e  val PSNR=%.3f  (no-learn %.3f)\n", s, lam, p, base_psnr);
      std::fflush(stdout);
      if (p > best_psnr) {
        best_psnr = p;
        best_lam = lam;
        best = std::move(m);
      }
    }
    size_t nvalid = 0;
    for (uint8_t v : best.valid) nvalid += v;
    std::printf("x%d  chose lambda=%.0e  val PSNR %.3f -> %.3f (%+.3f dB), %zu/%zu filters\n", s, best_lam,
                base_psnr, best_psnr, best_psnr - base_psnr, nvalid, best.valid.size());
    save_model(best, out_dir + "/model_x" + std::to_string(s) + ".bin");
  }
  return 0;
}

// ---------------------------------------------------------------- eval

struct SetSpec {
  const char* name;
  std::string dir;
};

int cmd_eval(const std::string& data, const std::string& out_dir, int max_imgs) {
  ViceTuning t;
  vice_tuning_defaults(&t);
  bool tuned = load_tuning(out_dir + "/tuning.txt", t);
  Model models[5];
  for (int s : {2, 3, 4}) load_model(models[s], out_dir + "/model_x" + std::to_string(s) + ".bin");
  std::printf("tuned base: %s | learned models: x2=%d x3=%d x4=%d\n", tuned ? "yes" : "no (defaults)",
              models[2].ok(), models[3].ok(), models[4].ok());

  std::vector<SetSpec> sets = {{"Set5", data + "/Set5/Set5/image_SRF_2"},
                               {"Set14", data + "/Set14/Set14/image_SRF_2"},
                               {"Urban100", data + "/Urban100/Urban100_HR"}};
  std::printf("%-9s %-3s %-4s %-15s %7s %7s %6s %6s %6s %6s %4s\n", "set", "x", "lr", "method", "resid",
              "psnr", "ssim", "seam", "sharp", "ring", "n");
  for (auto& set : sets) {
    auto files = list_hr(set.dir);
    if (max_imgs > 0 && (int)files.size() > max_imgs) files.resize((size_t)max_imgs);
    if (files.empty()) continue;
    for (int s : {2, 3, 4}) {
      // [image][deg][method]
      std::vector<M> res(files.size() * 2 * kNumMethods);
      std::vector<uint8_t> okv(files.size(), 0);
      parallel_for((int)files.size(), [&](int i, int) {
        Img hr;
        if (!load_hr(files[(size_t)i], s, hr)) return;
        okv[(size_t)i] = 1;
        int w = hr.w / s, h = hr.h / s;
        RefStats ref = make_ref(hr);
        for (int deg = 0; deg < 2; deg++) {
          std::vector<float> lr((size_t)w * h * 3);
          if (deg == 0)
            vice_box_downscale(hr.px.data(), lr.data(), w, h, s, 3);
          else
            bicubic_down(hr.px.data(), lr.data(), hr.w, hr.h, w, h, 3);
          for (int me = 0; me < kNumMethods; me++) {
            auto out = run_method((Method)me, lr, w, h, s, t, &models[s]);
            res[((size_t)i * 2 + (size_t)deg) * kNumMethods + (size_t)me] = measure(out, lr, hr, ref, s);
          }
        }
      });
      for (int deg = 0; deg < 2; deg++)
        for (int me = 0; me < kNumMethods; me++) {
          M a;
          int n = 0;
          for (size_t i = 0; i < files.size(); i++) {
            if (!okv[i]) continue;
            const M& r = res[(i * 2 + (size_t)deg) * kNumMethods + (size_t)me];
            a.resid = std::max(a.resid, r.resid);
            a.psnr += r.psnr;
            a.ssim += r.ssim;
            a.seam += r.seam;
            a.sharp += r.sharp;
            a.ring += r.ring;
            n++;
          }
          if (!n) continue;
          std::printf("%-9s %-3d %-4s %-15s %7.1e %7.2f %6.4f %6.3f %6.3f %6.2f %4d\n", set.name, s,
                      deg == 0 ? "box" : "bic", kMethodName[me], a.resid, a.psnr / n, a.ssim / n,
                      a.seam / n, a.sharp / n, a.ring / n, n);
        }
      std::fflush(stdout);
    }
  }
  return 0;
}

} // namespace

int main(int argc, char** argv) {
  if (argc < 3) {
    std::fprintf(stderr, "usage: vice_lab tune|train|eval <data_dir> [max_images] [out_dir]\n");
    return 2;
  }
  std::string cmd = argv[1], data = argv[2];
  int max_imgs = argc > 3 ? std::atoi(argv[3]) : 0;
  std::string out_dir = argc > 4 ? argv[4] : "tools/lab/out";
  if (cmd == "tune") return cmd_tune(data, out_dir);
  if (cmd == "train") return cmd_train(data, out_dir);
  if (cmd == "eval") return cmd_eval(data, out_dir, max_imgs);
  std::fprintf(stderr, "unknown command %s\n", cmd.c_str());
  return 2;
}
