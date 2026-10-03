// Model manifest: single source of truth for the neural path.
// Weights: RealPLKSR x2 (MIT, dslisleedh/PLKSR via darktable-org re-export).
// RGB sRGB [0,1], static 512x512 in -> 1024x1024 out. Tiled with reflect pad.
// ORT runtime self-hosted under <base>/ort/ (see worker:build notes).

export interface ViceModelManifest {
  name: string;
  file: string;
  sha256: string;
  bytes: number;
  scale: 2;
  tile: number;
  overlap: number;
  license: string;
  source: string;
}

export const VICE_MODEL: ViceModelManifest = {
  name: "realplksr-x2",
  file: "models/realplksr-x2.onnx",
  sha256: "d7abb65092f3808d3aa255ffdab42b1d672883915d90adbdd321204168b9f293",
  bytes: 29627920,
  scale: 2,
  tile: 512,
  overlap: 32,
  license: "MIT",
  source: "https://huggingface.co/darktable-org/upscale-realplksr-onnx",
};

// Bilinear fallback tiling (no model): small disjoint tiles, weight 1.
export const VICE_FALLBACK = { tile: 128, overlap: 0 } as const;

export interface ViceAssets {
  base: string; // page origin + basePath, trailing slash. Model at base+file.
}

export function modelUrl(a: ViceAssets): string {
  return a.base + VICE_MODEL.file;
}
export function ortModuleUrl(a: ViceAssets): string {
  // Full bundle (all EPs incl. WebGPU); the session picks EPs at runtime.
  return `${a.base}ort/ort.min.mjs`;
}
export function ortWasmBase(a: ViceAssets): string {
  return `${a.base}ort/`;
}
