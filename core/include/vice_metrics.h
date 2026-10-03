#pragma once

// Quality metrics for Vice eval (spec sec 10). Float domain [0,1].
// PSNR + SSIM on Rec.709 luma; seam ratio across all channels.

double vice_psnr(const float* a, const float* b, int w, int h, int c);
double vice_ssim(const float* a, const float* b, int w, int h, int c);
double vice_seam_ratio(const float* img, int w, int h, int s, int c);

// Box-downscale HR (W=s*w) to LR (w). Matches the consistency guarantee.
void vice_box_downscale(const float* hr, float* lr, int w, int h, int s, int c);
