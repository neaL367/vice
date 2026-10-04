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
  shock?: number;
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
  const sharpness = Math.max(0, Math.min(1, options?.sharpness ?? 0.35));
  // Preset 1 (Smooth / CGI): suppress acutance boosting to avoid ringing on rendered surfaces
  const boostMult = preset === "smooth" ? 0 : 0.45;

  // Pass 1: Horizontal scale (w x h -> W x h)
  const tmp = new Float32Array(W * h * c);
  const xCoords = new Array<{ baseIdx: number; frac: number; lutOffset: number }>(W);
  for (let x = 0; x < W; x++) {
    const srcX = (x + 0.5) / scale - 0.5;
    const baseIdx = Math.floor(srcX);
    const frac = srcX - baseIdx;
    const lutIdx = Math.min(LANCZOS_LUT_STEPS - 1, Math.max(0, (frac * LANCZOS_LUT_STEPS) | 0));
    xCoords[x] = { baseIdx, frac, lutOffset: lutIdx * 6 };
  }

  for (let y = 0; y < h; y++) {
    const rowSrc = y * w;
    const rowDst = y * W;

    for (let x = 0; x < W; x++) {
      const { baseIdx, frac, lutOffset } = xCoords[x];

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

  // Pass 4: Coherence Shock PDE Edge Steeper (Vice 2.0 Engine)
  const shock = Math.max(0, Math.min(1, options?.shock ?? (preset === "photo" ? 0.35 : 0)));
  if (shock > 0.001) {
    const shocked = applyCoherenceShockFilter(dst, W, H, c, shock, 2);
    dst.set(shocked);
  }

  return dst;
}

export interface StructureTensorField {
  coherence: Float32Array; // [w * h] in [0, 1]
  angle: Float32Array;     // [w * h] in radians [-PI/2, PI/2]
  energy: Float32Array;    // [w * h] gradient magnitude
}

/**
 * Computes continuous Structure Tensor J = K_rho * (grad I (x) grad I)
 * using 1st-order isotropic Scharr gradients and 3x3 Gaussian smoothing.
 */
export function computeStructureTensor(
  src: Float32Array,
  w: number,
  h: number,
  c: number,
): StructureTensorField {
  const size = w * h;
  const coherence = new Float32Array(size);
  const angle = new Float32Array(size);
  const energy = new Float32Array(size);

  const jxx = new Float32Array(size);
  const jyy = new Float32Array(size);
  const jxy = new Float32Array(size);

  // Compute Scharr gradients (luminance)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(h - 1, y + 1);
    const rowY = y * w;
    const rowY0 = y0 * w;
    const rowY1 = y1 * w;

    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(w - 1, x + 1);

      const getLum = (offset: number) => {
        const idx = offset * c;
        return c >= 3 ? 0.2126 * src[idx] + 0.7152 * src[idx + 1] + 0.0722 * src[idx + 2] : src[idx];
      };

      const tl = getLum(rowY0 + x0);
      const tc = getLum(rowY0 + x);
      const tr = getLum(rowY0 + x1);
      const ml = getLum(rowY + x0);
      const mr = getLum(rowY + x1);
      const bl = getLum(rowY1 + x0);
      const bc = getLum(rowY1 + x);
      const br = getLum(rowY1 + x1);

      const gx = (3 * (tr - tl) + 10 * (mr - ml) + 3 * (br - bl)) / 32;
      const gy = (3 * (bl - tl) + 10 * (bc - tc) + 3 * (br - tr)) / 32;

      const idx = rowY + x;
      jxx[idx] = gx * gx;
      jyy[idx] = gy * gy;
      jxy[idx] = gx * gy;
      energy[idx] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  // 3x3 Gaussian smoothing for tensor integration scale
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1) * w;
    const yc = y * w;
    const y1 = Math.min(h - 1, y + 1) * w;

    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(w - 1, x + 1);

      const sxx = (
        jxx[y0 + x0] + 2 * jxx[y0 + x] + jxx[y0 + x1] +
        2 * jxx[yc + x0] + 4 * jxx[yc + x] + 2 * jxx[yc + x1] +
        jxx[y1 + x0] + 2 * jxx[y1 + x] + jxx[y1 + x1]
      ) / 16;

      const syy = (
        jyy[y0 + x0] + 2 * jyy[y0 + x] + jyy[y0 + x1] +
        2 * jyy[yc + x0] + 4 * jyy[yc + x] + 2 * jyy[yc + x1] +
        jyy[y1 + x0] + 2 * jyy[y1 + x] + jyy[y1 + x1]
      ) / 16;

      const sxy = (
        jxy[y0 + x0] + 2 * jxy[y0 + x] + jxy[y0 + x1] +
        2 * jxy[yc + x0] + 4 * jxy[yc + x] + 2 * jxy[yc + x1] +
        jxy[y1 + x0] + 2 * jxy[y1 + x] + jxy[y1 + x1]
      ) / 16;

      const trace = sxx + syy;
      const det = sxx * syy - sxy * sxy;
      const disc = Math.max(0, trace * trace - 4 * det);
      const sqrtDisc = Math.sqrt(disc);
      const lambda1 = (trace + sqrtDisc) * 0.5;
      const lambda2 = Math.max(0, (trace - sqrtDisc) * 0.5);

      const denom = lambda1 + lambda2 + 1e-5;
      const coh = Math.pow((lambda1 - lambda2) / denom, 2);
      const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy) + Math.PI / 2;

      const idx = yc + x;
      coherence[idx] = Math.max(0, Math.min(1, coh));
      angle[idx] = theta;
    }
  }

  return { coherence, angle, energy };
}

/**
 * Coherence-Enhancing Nonlinear Shock PDE Filter:
 * dI/dt = -sign(I_eta_eta) * |grad I|
 * Steepens blurry transition zones into crisp sub-pixel steps without overshoot.
 */
export function applyCoherenceShockFilter(
  img: Float32Array,
  w: number,
  h: number,
  c: number,
  strength = 0.5,
  iterations = 2,
): Float32Array {
  if (strength <= 0.001) return img;
  const current = new Float32Array(img);
  const next = new Float32Array(img.length);
  const dt = 0.12 * Math.min(1, strength);

  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < h; y++) {
      const ym1 = Math.max(0, y - 1) * w;
      const yc = y * w;
      const yp1 = Math.min(h - 1, y + 1) * w;

      for (let x = 0; x < w; x++) {
        const xm1 = Math.max(0, x - 1);
        const xp1 = Math.min(w - 1, x + 1);

        for (let ch = 0; ch < c; ch++) {
          const cCenter = current[(yc + x) * c + ch];
          const cL = current[(yc + xm1) * c + ch];
          const cR = current[(yc + xp1) * c + ch];
          const cT = current[(ym1 + x) * c + ch];
          const cB = current[(yp1 + x) * c + ch];
          const cTL = current[(ym1 + xm1) * c + ch];
          const cTR = current[(ym1 + xp1) * c + ch];
          const cBL = current[(yp1 + xm1) * c + ch];
          const cBR = current[(yp1 + xp1) * c + ch];

          const Ix = 0.5 * (cR - cL);
          const Iy = 0.5 * (cB - cT);
          const gradSq = Ix * Ix + Iy * Iy;
          const gradNorm = Math.sqrt(gradSq + 1e-6);

          const Ixx = cR - 2 * cCenter + cL;
          const Iyy = cB - 2 * cCenter + cT;
          const Ixy = 0.25 * (cBR - cBL - cTR + cTL);

          const I_eta_eta = (Ix * Ix * Ixx + 2 * Ix * Iy * Ixy + Iy * Iy * Iyy) / (gradSq + 1e-6);
          const shock = -Math.tanh(6 * I_eta_eta) * gradNorm;
          const update = cCenter + dt * shock;
          next[(yc + x) * c + ch] = Math.max(0, Math.min(1, update));
        }
      }
    }
    current.set(next);
  }
  return current;
}
