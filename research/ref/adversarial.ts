// Adversarial synthetic battery (zero deps, deterministic).
// Each family targets one falsification property. HR fixtures sized so that
// box-downsampling by 2 and 4 divides evenly. Grayscale; alpha probe deferred
// to ticket 06 (color.ts). Noise uses a seeded LCG — same bytes every run.

import type { GrayImage } from "./kernels.ts";

export interface Fixture {
  name: string;
  hr: GrayImage;
  /** What this fixture falsifies / probes. */
  property: string;
}

function make(w: number, h: number, fn: (x: number, y: number) => number): GrayImage {
  const data = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y);
  return { w, h, data };
}

/** Deterministic PRNG (LCG, seeded). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const S = 32; // default HR dimension (divisible by 2 and 4)

export function fixtureImpulse(): Fixture {
  return {
    name: "impulse",
    hr: make(S, S, (x, y) => (x === 16 && y === 16 ? 255 : 0)),
    property: "Point response: measures kernel footprint + ringing sidelobes. No method recovers subpixel position beyond block mean.",
  };
}

export function fixtureCheckerboard(): Fixture {
  return {
    name: "checkerboard",
    hr: make(S, S, (x, y) => ((x + y) % 2 === 0 ? 0 : 255)),
    property: "Period-2 aliasing probe: box-D maps every block mean to 127.5 — nullspace is total. Any reconstructed pattern here is invention.",
  };
}

export function fixtureSineSweep(): Fixture {
  return {
    name: "sine-sweep",
    hr: make(64, S, (x) => {
      // Proper chirp: phase φ(x) = πx²/126 → instantaneous freq x/126, 0 → Nyquist.
      return 127.5 + 127.5 * Math.sin((Math.PI * x * x) / 126);
    }),
    property: "Horizontal chirp to Nyquist (instantaneous freq x/126 cyc/px): locates cutoff where each kernel/IBP stops tracking.",
  };
}

export function fixtureNyquist(): Fixture {
  return {
    name: "nyquist-stripes",
    hr: make(S, S, (x) => (x % 2 === 0 ? 0 : 255)),
    property: "Nyquist columns: box-D erases completely (every block mean 127.5). Recovery claim here = hallucination by definition.",
  };
}

export function fixtureDiagonal(): Fixture {
  return {
    name: "diagonal-line",
    hr: make(S, S, (x, y) => (Math.abs(x - y) < 1 ? 255 : 0)),
    property: "1px 45° line: isotropic kernels stair-step; directional kernels must win here or adaptivity is pointless.",
  };
}

export function fixtureThinH(): Fixture {
  return {
    name: "thin-h-line",
    hr: make(S, S, (_x, y) => (y === 16 ? 255 : 0)),
    property: "1px horizontal line: survives box-D at 1/2 or 1/4 amplitude. Tests line preservation vs smoothing.",
  };
}

export function fixtureThinV(): Fixture {
  return {
    name: "thin-v-line",
    hr: make(S, S, (x) => (x === 16 ? 255 : 0)),
    property: "1px vertical line: transpose twin of thin-h; catches separable-pass asymmetry bugs.",
  };
}

export function fixtureThinDiag(): Fixture {
  return {
    name: "thin-diag-line",
    hr: make(S, S, (x, y) => (Math.abs(x - 2 * y + 16) < 1 ? 255 : 0)),
    property: "Shallow-angle (~27°) line: worst case for axis-aligned kernels; anisotropic direction must interpolate orientations, not just 45°.",
  };
}

export function fixtureStep(): Fixture {
  return {
    name: "step-edge",
    hr: make(S, S, (x) => (x < 16 ? 0 : 255)),
    property: "Ideal step: ringing/overshoot measured directly; edge displacement measured vs ground truth column.",
  };
}

export function fixtureGradient(): Fixture {
  return {
    name: "gradient-ramp",
    hr: make(S, S, (x) => (x / (S - 1)) * 255),
    property: "Smooth ramp: any banding/staircasing is method artifact. TV methods staircase here — watch for it.",
  };
}

export function fixtureRepeated(): Fixture {
  return {
    name: "repeated-blocks",
    hr: make(S, S, (x, y) => (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? 40 : 215),
    property: "4px block repeat: sub-Nyquist texture that survives D partially. Tests texture vs edge classification.",
  };
}

export function fixturePeriodic(): Fixture {
  return {
    name: "periodic-sine2d",
    hr: make(S, S, (x, y) => 127.5 + 127.5 * Math.sin((2 * Math.PI * x) / 8) * Math.sin((2 * Math.PI * y) / 8)),
    property: "8px-period 2D sine: mid-frequency content every method should preserve; failure = broken passband.",
  };
}

export function fixtureNoise(): Fixture {
  const rnd = lcg(0xC0FFEE);
  const vals = new Float64Array(S * S);
  for (let i = 0; i < vals.length; i++) vals[i] = rnd() * 255;
  return {
    name: "white-noise",
    hr: { w: S, h: S, data: vals },
    property: "White noise: HF is noise by construction. Reconstruction must go conservative — any sharpening here amplifies lies.",
  };
}

export function fixtureJpegBlocks(): Fixture {
  return {
    name: "jpeg-blocks",
    hr: make(S, S, (x, y) => {
      const bx = Math.floor(x / 8);
      const by = Math.floor(y / 8);
      const base = (bx * 37 + by * 91) % 2 === 0 ? 60 : 195;
      const edge = x % 8 === 0 || y % 8 === 0 ? -25 : 0; // block-boundary trough
      return Math.max(0, Math.min(255, base + edge));
    }),
    property: "8px block grid with boundary troughs: JPEG-block surrogate. Tests block detection + joint deblock hypothesis.",
  };
}

export function fixtureMixed(): Fixture {
  return {
    name: "mixed-frequency",
    hr: make(S, S, (x, y) => {
      if (x < 16) return (x / 15) * 255; // smooth left
      return (x + y) % 2 === 0 ? 0 : 255; // checker right
    }),
    property: "Smooth||checker junction: single global λ cannot serve both halves. Adaptive methods must win here or nowhere.",
  };
}

const L = 128; // photo-scale dimension (divisible by 2 and 4)

export function fixturePhotoSurrogate(): Fixture {
  // Deterministic natural-image surrogate: 1/f broadband field (summed sines,
  // amplitude ∝ 1/f, LCG phases) + step edge + gradient wedge + sine patch.
  // Tests whether the adaptive law transfers beyond 32px toy sizes.
  const phases: number[] = [];
  const r2 = lcg(0xbeef);
  for (let k = 0; k < 240; k++) phases.push(r2() * 2 * Math.PI);
  const field = make(L, L, (x, y) => {
    let v = 0;
    for (let k = 0; k < 240; k++) {
      const fx = 1 + (k % 16);
      const fy = 1 + Math.floor(k / 16);
      const amp = 1 / Math.hypot(fx, fy);
      v += amp * Math.sin((2 * Math.PI * (fx * x + fy * y)) / L + phases[k]);
    }
    return v;
  });
  // Normalize to [0,255], then composite structure.
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of field.data) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const data = new Float64Array(L * L);
  for (let y = 0; y < L; y++)
    for (let x = 0; x < L; x++) {
      let v = ((field.data[y * L + x] - mn) / (mx - mn)) * 255;
      if (x >= 84) v = v * 0.35 + 150; // bright step region right (edge at x=84)
      if (y >= 96 && x < 64) v = v * 0.3 + 40 + 60 * Math.sin((2 * Math.PI * x) / 8); // sine patch
      if (x < 32 && y < 32) v = (x / 31) * 255; // gradient wedge corner
      data[y * L + x] = Math.max(0, Math.min(255, v));
    }
  return {
    name: "photo-surrogate",
    hr: { w: L, h: L, data },
    property: "128px 1/f field + step + sine patch + gradient wedge: photo-scale mixed content. Law must hold here, not just on 32px toys.",
  };
}

export function allFixtures(): Fixture[] {
  return [
    fixtureImpulse(),
    fixtureCheckerboard(),
    fixtureSineSweep(),
    fixtureNyquist(),
    fixtureDiagonal(),
    fixtureThinH(),
    fixtureThinV(),
    fixtureThinDiag(),
    fixtureStep(),
    fixtureGradient(),
    fixtureRepeated(),
    fixturePeriodic(),
    fixtureNoise(),
    fixtureJpegBlocks(),
    fixtureMixed(),
    fixturePhotoSurrogate(),
  ];
}
