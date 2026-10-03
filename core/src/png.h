#pragma once
#include <cstdint>
#include <vector>
// PNG writer v2: 8-bit RGB/RGBA, adaptive filter (None/Sub/Up/Paeth by min
// sum-abs heuristic) + miniz DEFLATE level 6.
int vice_encode_png(const unsigned char* rgba, int w, int h, int channels,
                    std::vector<unsigned char>& out);
int vice_encode_png_ex(const unsigned char* rgba, int w, int h, int channels,
                       const unsigned char* icc_data, size_t icc_size,
                       std::vector<unsigned char>& out);
uint32_t vice_crc32(const unsigned char* d, size_t n);
uint32_t vice_adler32(const unsigned char* d, size_t n);

