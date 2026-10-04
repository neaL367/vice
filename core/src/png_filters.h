#pragma once
#include <cstddef>
#include <cstdint>
#include <vector>

void png_put32(std::vector<unsigned char>& o, uint32_t v);
void png_chunk(std::vector<unsigned char>& o, const char* type,
               const unsigned char* d, size_t n);
void append_iccp(std::vector<unsigned char>& o, const unsigned char* icc_data,
                 size_t icc_size);

uint32_t vice_crc32(const unsigned char* d, size_t n);
uint32_t vice_adler32(const unsigned char* d, size_t n);
uint32_t adler_extend(uint32_t adler, const unsigned char* d, size_t n);

int paeth_pred(int a, int b, int c);
unsigned filter_row(const unsigned char* row, const unsigned char* prev,
                    unsigned char* out, size_t stride, int bpp, int f);
void filter_best_row(const unsigned char* row, const unsigned char* prev_or_null,
                     unsigned char* crow, unsigned char* cand, size_t stride,
                     int bpp);
