/**
 * Super-resolution scaling kernels:
 * - Bilinear interpolation
 * - Edge-adaptive separable Lanczos-3 with diagonal edge steering
 * - Anti-ringing bounds clamping
 * - Null-space micro-texture sharpness enhancement
 */

export interface LanczosAdaptiveOptions {
  dering?: number;
  sharpness?: number;
  preset?: "photo" | "smooth" | "pixel-art";
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

export function lanczos3(x: number): number {
  const ax = Math.abs(x);
  if (ax === 0) return 1;
  if (ax >= 3) return 0;
  return sinc(ax) * sinc(ax / 3);
}

// Precomputed weights for fast 6-tap Lanczos-3 resampling
export const LANCZOS_LUT_STEPS = 256;
export const LANCZOS_WEIGHT_TABLE = new Float32Array(LANCZOS_LUT_STEPS * 6);
for (let s = 0; s < LANCZOS_LUT_STEPS; s++) {
  const frac = s / LANCZOS_LUT_STEPS;
  let sum = 0;
  for (let tap = -2; tap <= 3; tap++) {
    const w = lanczos3(frac - tap);
    LANCZOS_WEIGHT_TABLE[s * 6 + (tap + 2)] = w;
    sum += w;
  }
  const invSum = sum !== 0 ? 1 / sum : 1;
  for (let i = 0; i < 6; i++) {
    LANCZOS_WEIGHT_TABLE[s * 6 + i] *= invSum;
  }
}

// Bilinear scale interpolation with generic integer factor.
export function bilinearScale(
  src: Float32Array,
  w: number,
  h: number,
  c: number,
  s: number,
): Float32Array {
  const W = w * s;
  const H = h * s;
  const dst = new Float32Array(W * H * c);
  for (let y = 0; y < H; y++) {
    const gy = y / s - 0.5;
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(gy)));
    const y1 = Math.max(0, Math.min(h - 1, y0 + 1));
    const fy = Math.max(0, Math.min(1, gy - y0));
    for (let x = 0; x < W; x++) {
      const gx = x / s - 0.5;
      const x0 = Math.max(0, Math.min(w - 1, Math.floor(gx)));
      const x1 = Math.max(0, Math.min(w - 1, x0 + 1));
      const fx = Math.max(0, Math.min(1, gx - x0));
      for (let ch = 0; ch < c; ch++) {
        const a = src[(y0 * w + x0) * c + ch];
        const b = src[(y0 * w + x1) * c + ch];
        const d = src[(y1 * w + x0) * c + ch];
        const e = src[(y1 * w + x1) * c + ch];
        dst[(y * W + x) * c + ch] =
          a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + d * (1 - fx) * fy + e * fx * fy;
      }
    }
  }
  return dst;
}

export function bilinear2x(src: Float32Array, w: number, h: number, c: number): Float32Array {
  return bilinearScale(src, w, h, c, 2);
}

/**
 * High-Performance Separable Edge-Adaptive Lanczos-3 Resampling with Diagonal Steering.
 * - Interpolates in linear premultiplied float space.
 * - Multi-scale acutance restores fine micro-contrast on 4K+ sensors.
 * - Diagonal edge steering eliminates staircase stepping along oblique contours.
 * - Anti-ringing bounds clamp prevents sinc edge halos.
 */
export function lanczosAdaptiveScale(
  src: Float32Array,
  w: number,
  h: number,
  c: number,
  scale: number,
  options?: LanczosAdaptiveOptions,
): Float32Array {
  const W = w * scale;
  const H = h * scale;
  const preset = options?.preset ?? "photo";

  // Preset 2: Pixel Art (exact nearest-neighbor integer box expansion)
  if (preset === "pixel-art") {
    const dst = new Float32Array(W * H * c);
    for (let by = 0; by < h; by++) {
      for (let bx = 0; bx < w; bx++) {
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            for (let ch = 0; ch < c; ch++) {
              dst[(((by * scale + dy) * W) + bx * scale + dx) * c + ch] =
                src[(by * w + bx) * c + ch];
            }
          }
        }
      }
    }
    return dst;
  }

  const dering = Math.max(0, Math.min(1, options?.dering ?? 1.0));
  const sharpness = Math.max(0, Math.min(1, options?.sharpness ?? 0.2));
  // Preset 1 (Smooth / CGI): suppress acutance boosting to avoid ringing on rendered surfaces
  const boostMult = preset === "smooth" ? 0 : 0.45;

  // Pass 1: Horizontal scale (w x h -> W x h)
  const tmp = new Float32Array(W * h * c);
  for (let x = 0; x < W; x++) {
    const srcX = (x + 0.5) / scale - 0.5;
    const baseIdx = Math.floor(srcX);
    const frac = srcX - baseIdx;
    const lutIdx = Math.min(LANCZOS_LUT_STEPS - 1, Math.max(0, (frac * LANCZOS_LUT_STEPS) | 0));
    const lutOffset = lutIdx * 6;

    for (let y = 0; y < h; y++) {
      const rowSrc = y * w;
      const rowDst = y * W;

      for (let ch = 0; ch < c; ch++) {
        let val = 0;
        let min4 = Infinity;
        let max4 = -Infinity;

        // Central pixels for acutance curvature calculation
        const p0 = src[(rowSrc + Math.max(0, Math.min(w - 1, baseIdx))) * c + ch];
        const p1 = src[(rowSrc + Math.max(0, Math.min(w - 1, baseIdx + 1))) * c + ch];
        const pm1 = src[(rowSrc + Math.max(0, Math.min(w - 1, baseIdx - 1))) * c + ch];
        const p2 = src[(rowSrc + Math.max(0, Math.min(w - 1, baseIdx + 2))) * c + ch];

        for (let tap = -2; tap <= 3; tap++) {
          const sx = Math.max(0, Math.min(w - 1, baseIdx + tap));
          const pixel = src[(rowSrc + sx) * c + ch];
          val += pixel * LANCZOS_WEIGHT_TABLE[lutOffset + (tap + 2)];

          if (tap >= -1 && tap <= 2) {
            if (pixel < min4) min4 = pixel;
            if (pixel > max4) max4 = pixel;
          }
        }

        // Noise-gated multi-scale edge acutance: suppresses sensor/compression noise on smooth areas
        if (boostMult > 0) {
          const localDelta = Math.abs(p1 - p0);
          const wideDelta = Math.abs(p2 - pm1);
          const edgeEnergy = Math.max(localDelta, 0.5 * wideDelta);
          const NOISE_FLOOR = 0.008;

          if (edgeEnergy > NOISE_FLOOR) {
            const linearCenter = p0 + frac * (p1 - p0);
            const wideCenter = 0.5 * (pm1 + p2);
            const curvature = linearCenter - wideCenter;
            const boost = boostMult * Math.min(1, (edgeEnergy - NOISE_FLOOR) * 6);
            val += boost * curvature;
          }
        }

        // Anti-ringing clamp bounded by the 4-tap local envelope
        if (dering > 0) {
          const clamped = val < min4 ? min4 : val > max4 ? max4 : val;
          val = (1 - dering) * val + dering * clamped;
        }
        tmp[(rowDst + x) * c + ch] = val;
      }
    }
  }

  // Pass 2: Vertical scale with Diagonal Edge Steering (W x h -> W x H)
  const dst = new Float32Array(W * H * c);
  const stepX = Math.max(1, Math.round(scale));

  for (let y = 0; y < H; y++) {
    const srcY = (y + 0.5) / scale - 0.5;
    const baseIdx = Math.floor(srcY);
    const frac = srcY - baseIdx;
    const lutIdx = Math.min(LANCZOS_LUT_STEPS - 1, Math.max(0, (frac * LANCZOS_LUT_STEPS) | 0));
    const lutOffset = lutIdx * 6;

    const rowDst = y * W;
    for (let x = 0; x < W; x++) {
      for (let ch = 0; ch < c; ch++) {
        let val = 0;
        let min4 = Infinity;
        let max4 = -Infinity;

        const p0 = tmp[(Math.max(0, Math.min(h - 1, baseIdx)) * W + x) * c + ch];
        const p1 = tmp[(Math.max(0, Math.min(h - 1, baseIdx + 1)) * W + x) * c + ch];
        const pm1 = tmp[(Math.max(0, Math.min(h - 1, baseIdx - 1)) * W + x) * c + ch];
        const p2 = tmp[(Math.max(0, Math.min(h - 1, baseIdx + 2)) * W + x) * c + ch];

        for (let tap = -2; tap <= 3; tap++) {
          const sy = Math.max(0, Math.min(h - 1, baseIdx + tap));
          const pixel = tmp[(sy * W + x) * c + ch];
          val += pixel * LANCZOS_WEIGHT_TABLE[lutOffset + (tap + 2)];

          if (tap >= -1 && tap <= 2) {
            if (pixel < min4) min4 = pixel;
            if (pixel > max4) max4 = pixel;
          }
        }

        // Noise-gated vertical edge acutance
        if (boostMult > 0) {
          const localDelta = Math.abs(p1 - p0);
          const wideDelta = Math.abs(p2 - pm1);
          const edgeEnergy = Math.max(localDelta, 0.5 * wideDelta);
          const NOISE_FLOOR = 0.008;

          if (edgeEnergy > NOISE_FLOOR) {
            const linearCenter = p0 + frac * (p1 - p0);
            const wideCenter = 0.5 * (pm1 + p2);
            const curvature = linearCenter - wideCenter;
            const boost = boostMult * Math.min(1, (edgeEnergy - NOISE_FLOOR) * 6);
            val += boost * curvature;
          }
        }

        // Diagonal Edge Steering: evaluate 45° vs 135° cross gradients
        const xL = Math.max(0, x - stepX);
        const xR = Math.min(W - 1, x + stepX);
        const yTop = Math.max(0, Math.min(h - 1, baseIdx));
        const yBot = Math.max(0, Math.min(h - 1, baseIdx + 1));

        const tl = tmp[(yTop * W + xL) * c + ch];
        const tr = tmp[(yTop * W + xR) * c + ch];
        const bl = tmp[(yBot * W + xL) * c + ch];
        const br = tmp[(yBot * W + xR) * c + ch];

        const d45 = Math.abs(tr - bl);
        const d135 = Math.abs(tl - br);
        const diff = d135 - d45;
        const total = d135 + d45 + 1e-4;

        if (Math.abs(diff) / total > 0.15) {
          // If d135 > d45, edge is at 45° -> average along tr-bl
          // If d45 > d135, edge is at 135° -> average along tl-br
          const diagAvg = diff > 0 ? 0.5 * (tr + bl) : 0.5 * (tl + br);
          const steerWeight = 0.2 * Math.min(1, Math.abs(diff) / total);
          val = (1 - steerWeight) * val + steerWeight * diagAvg;
        }

        // Anti-ringing clamp bounded by the 4-tap local envelope
        if (dering > 0) {
          const clamped = val < min4 ? min4 : val > max4 ? max4 : val;
          val = (1 - dering) * val + dering * clamped;
        }
        dst[(rowDst + x) * c + ch] = val;
      }
    }
  }

  // Pass 3: Null-Space Micro-Texture Sharpness Enhancement
  if (sharpness > 0.001) {
    const sharpTmp = new Float32Array(W * H * c);
    for (let y = 0; y < H; y++) {
      const yPrev = Math.max(0, y - 1);
      const yNext = Math.min(H - 1, y + 1);
      for (let x = 0; x < W; x++) {
        const xPrev = Math.max(0, x - 1);
        const xNext = Math.min(W - 1, x + 1);
        for (let ch = 0; ch < c; ch++) {
          const center = dst[(y * W + x) * c + ch];
          const n = dst[(yPrev * W + x) * c + ch];
          const s = dst[(yNext * W + x) * c + ch];
          const wPx = dst[(y * W + xPrev) * c + ch];
          const e = dst[(y * W + xNext) * c + ch];
          const blur = 0.5 * center + 0.125 * (n + s + wPx + e);
          const hp = center - blur;
          sharpTmp[(y * W + x) * c + ch] = center + sharpness * hp;
        }
      }
    }
    dst.set(sharpTmp);
  }

  return dst;
}
