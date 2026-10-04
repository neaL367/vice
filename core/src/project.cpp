#include "vice.h"
#include <vector>

// out = U(y) + (r - U(A(r))) per spec section 3.
// y: h x w x C, raw: (h*s) x (w*s) x C, in-place.
void vice_project_box(const float* y, float* raw, int w, int h, int s, int c) {
  const int W = w * s;
  const double inv = 1.0 / (double(s) * s);
  for (int by = 0; by < h; ++by) {
    for (int bx = 0; bx < w; ++bx) {
      for (int ch = 0; ch < c; ++ch) {
        double sum = 0.0;
        for (int dy = 0; dy < s; ++dy)
          for (int dx = 0; dx < s; ++dx)
            sum += raw[((by * s + dy) * W + bx * s + dx) * c + ch];
        float d = y[(by * w + bx) * c + ch] - (float)(sum * inv);
        for (int dy = 0; dy < s; ++dy)
          for (int dx = 0; dx < s; ++dx)
            raw[((by * s + dy) * W + bx * s + dx) * c + ch] += d;
      }
    }
  }
}

// Iterative back-projection with a smooth (bilinear) correction operator:
//   raw += Ubilinear(y - A(raw))
// A bilinear correction changes neighbouring blocks gradually instead of by a
// per-block constant, so it does not create block-boundary seams. It only
// converges approximately, so callers finish with vice_project_box, which makes
// the block means exact; by then the remaining offsets are tiny.
void vice_project_smooth(const float* y, float* raw, int w, int h, int s, int c,
                         int iterations) {
  const int W = w * s;
  const double inv = 1.0 / (double(s) * s);
  std::vector<float> d((size_t)w * h * c);
  for (int it = 0; it < iterations; ++it) {
    for (int by = 0; by < h; ++by)
      for (int bx = 0; bx < w; ++bx)
        for (int ch = 0; ch < c; ++ch) {
          double sum = 0.0;
          for (int dy = 0; dy < s; ++dy)
            for (int dx = 0; dx < s; ++dx)
              sum += raw[((by * s + dy) * W + bx * s + dx) * c + ch];
          d[((size_t)by * w + bx) * c + ch] =
              y[((size_t)by * w + bx) * c + ch] - (float)(sum * inv);
        }
    for (int py = 0; py < h * s; ++py) {
      float fy = ((float)py + 0.5f) / (float)s - 0.5f;
      int y0 = (int)(fy < 0 ? -1 : fy);
      if (fy < 0) y0 = -1;
      float ty = fy - (float)y0;
      int ya = y0 < 0 ? 0 : y0;
      int yb = y0 + 1 > h - 1 ? h - 1 : y0 + 1;
      for (int px = 0; px < W; ++px) {
        float fx = ((float)px + 0.5f) / (float)s - 0.5f;
        int x0 = (int)(fx < 0 ? -1 : fx);
        float tx = fx - (float)x0;
        int xa = x0 < 0 ? 0 : x0;
        int xb = x0 + 1 > w - 1 ? w - 1 : x0 + 1;
        const float alpha = (s == 2) ? 1.35f : 1.15f;
        for (int ch = 0; ch < c; ++ch) {
          float a = d[((size_t)ya * w + xa) * c + ch];
          float b = d[((size_t)ya * w + xb) * c + ch];
          float cc = d[((size_t)yb * w + xa) * c + ch];
          float e = d[((size_t)yb * w + xb) * c + ch];
          float top = a + (b - a) * tx;
          float bot = cc + (e - cc) * tx;
          raw[((size_t)py * W + px) * c + ch] += alpha * (top + (bot - top) * ty);
        }
      }
    }
  }
}

void vice_project_multigrid(const float* y, float* raw, int w, int h, int s, int c,
                            int cycles) {
  const int W = w * s;
  const int H = h * s;
  const double inv = 1.0 / (double(s) * s);

  for (int cyc = 0; cyc < cycles; ++cyc) {
    std::vector<float> d0((size_t)w * h * c);
    for (int by = 0; by < h; ++by) {
      for (int bx = 0; bx < w; ++bx) {
        for (int ch = 0; ch < c; ++ch) {
          double sum = 0.0;
          for (int dy = 0; dy < s; ++dy) {
            for (int dx = 0; dx < s; ++dx) {
              sum += raw[((by * s + dy) * W + bx * s + dx) * c + ch];
            }
          }
          d0[((size_t)by * w + bx) * c + ch] =
              y[((size_t)by * w + bx) * c + ch] - (float)(sum * inv);
        }
      }
    }

    if (w >= 4 && h >= 4) {
      const int cw = w / 2;
      const int ch = h / 2;
      std::vector<float> d1((size_t)cw * ch * c, 0.0f);
      for (int cy = 0; cy < ch; ++cy) {
        for (int cx = 0; cx < cw; ++cx) {
          for (int ch_idx = 0; ch_idx < c; ++ch_idx) {
            float block_sum = 0.0f;
            for (int ry = 0; ry < 2; ++ry) {
              for (int rx = 0; rx < 2; ++rx) {
                int fy = cy * 2 + ry;
                int fx = cx * 2 + rx;
                block_sum += d0[((size_t)fy * w + fx) * c + ch_idx];
              }
            }
            d1[((size_t)cy * cw + cx) * c + ch_idx] = block_sum * 0.25f;
          }
        }
      }

      const float coarse_scale = (float)(s * 2);
      for (int py = 0; py < H; ++py) {
        float fcy = ((float)py + 0.5f) / coarse_scale - 0.5f;
        int cy0 = (int)(fcy < 0 ? -1 : fcy);
        float tcy = fcy - (float)cy0;
        int cya = cy0 < 0 ? 0 : (cy0 >= ch ? ch - 1 : cy0);
        int cyb = cy0 + 1 >= ch ? ch - 1 : (cy0 + 1 < 0 ? 0 : cy0 + 1);

        for (int px = 0; px < W; ++px) {
          float fcx = ((float)px + 0.5f) / coarse_scale - 0.5f;
          int cx0 = (int)(fcx < 0 ? -1 : fcx);
          float tcx = fcx - (float)cx0;
          int cxa = cx0 < 0 ? 0 : (cx0 >= cw ? cw - 1 : cx0);
          int cxb = cx0 + 1 >= cw ? cw - 1 : (cx0 + 1 < 0 ? 0 : cx0 + 1);

          for (int ch_idx = 0; ch_idx < c; ++ch_idx) {
            float a = d1[((size_t)cya * cw + cxa) * c + ch_idx];
            float b = d1[((size_t)cya * cw + cxb) * c + ch_idx];
            float cc = d1[((size_t)cyb * cw + cxa) * c + ch_idx];
            float e = d1[((size_t)cyb * cw + cxb) * c + ch_idx];
            float top = a + (b - a) * tcx;
            float bot = cc + (e - cc) * tcx;
            float corr = top + (bot - top) * tcy;
            raw[((size_t)py * W + px) * c + ch_idx] += corr * 0.85f;
          }
        }
      }
    }

    vice_project_smooth(y, raw, w, h, s, c, 1);
  }

  vice_project_box(y, raw, w, h, s, c);
}
