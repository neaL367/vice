#pragma once
#include <vector>

// Tile plan helper: fixed input tiles + 16px overlap, reflect pad (spec sec 5).
struct ViceTile {
  int ix, iy, iw, ih; // input coords
  int ox, oy, ow, oh; // output coords (scaled)
};
struct VicePlan {
  int in_w, in_h, scale, tile, overlap;
  std::vector<ViceTile> tiles;
};

VicePlan vice_plan_tiles(int in_w, int in_h, int scale, int tile = 128,
                         int overlap = 16);
float vice_hann_weight(int x, int y, int w, int h);
