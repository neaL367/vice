#include "dither.h"
#include <cmath>

namespace vice {

// Standard 8x8 Bayer ordered-dither matrix (indices 0..63).
// threshold = (BAYER8[gy%8][gx%8] / 64.0 - 0.5) * amplitude
// where gx = bx * scale + dx, gy = by * scale + dy.
// Deterministic: same spatial coordinate always yields the same threshold.
static const int BAYER8[8][8] = {
  { 0,32, 8,40, 2,34,10,42},
  {48,16,56,24,50,18,58,26},
  {12,44, 4,36,14,46, 6,38},
  {60,28,52,20,62,30,54,22},
  { 3,35,11,43, 1,33, 9,41},
  {51,19,59,27,49,17,57,25},
  {15,47, 7,39,13,45, 5,37},
  {63,31,55,23,61,29,53,21}
};

double bayer_threshold(int bx, int by, int dx, int dy, int scale, double amplitude) {
  int gx = bx * scale + dx;
  int gy = by * scale + dy;
  // Use modulo with positive wrap to handle negative coordinates safely.
  int row = ((gy % 8) + 8) % 8;
  int col = ((gx % 8) + 8) % 8;
  return (BAYER8[row][col] / 64.0 - 0.5) * amplitude;
}

} // namespace vice
