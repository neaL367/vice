#include "tile.h"
#include <cmath>
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

VicePlan vice_plan_tiles(int in_w, int in_h, int scale, int tile, int overlap) {
  VicePlan p{in_w, in_h, scale, tile, overlap, {}};
  for (int y = 0; y < in_h; y += tile) {
    for (int x = 0; x < in_w; x += tile) {
      int iw = tile < in_w - x ? tile : in_w - x;
      int ih = tile < in_h - y ? tile : in_h - y;
      ViceTile t;
      t.ix = x;
      t.iy = y;
      t.iw = iw;
      t.ih = ih;
      t.ox = x * scale;
      t.oy = y * scale;
      t.ow = iw * scale;
      t.oh = ih * scale;
      p.tiles.push_back(t);
    }
  }
  return p;
}

float vice_hann_weight(int x, int y, int w, int h) {
  if (w <= 1 || h <= 1) return 1.0f;
  float wx = 0.5f - 0.5f * (float)std::cos(2.0 * M_PI * x / (w - 1));
  float wy = 0.5f - 0.5f * (float)std::cos(2.0 * M_PI * y / (h - 1));
  return wx * wy;
}
