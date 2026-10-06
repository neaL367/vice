// vice engine wrapper: loads the WASM core once, exposes upscale with ABI check.
// Runs inside a Web Worker (never the main thread).

export interface UpscaleResult {
  data: Uint8ClampedArray<ArrayBuffer>;
  w: number;
  h: number;
  residual: number;
  ms: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Core = any;
let core: Core | null = null;

async function load(): Promise<Core> {
  if (core) return core;
  // Served from public/wasm (committed build output). webpackIgnore keeps
  // Next from trying to bundle the Emscripten glue; it loads at runtime.
  const mod = (await import(/* webpackIgnore: true */ "/wasm/core.js")) as {
    default: () => Promise<Core>;
  };
  const c = await mod.default();
  const abi: number = c._vice_abi_version();
  if (abi !== 1) throw new Error(`WASM ABI mismatch: got ${abi}, want 1`);
  core = c;
  return c;
}

export async function upscaleImage(
  input: Uint8ClampedArray,
  w: number,
  h: number,
  scale: 2 | 3 | 4,
): Promise<UpscaleResult> {
  const c = await load();
  const t0 = performance.now();
  const pin = c._malloc(input.length);
  c.HEAPU8.set(input, pin);
  const ow = w * scale;
  const oh = h * scale;
  const pout = c._malloc(ow * oh * 4);
  const rc: number = c._vice_upscale(pin, w, h, 4, scale, pout);
  if (rc !== 0) {
    c._free(pin);
    c._free(pout);
    throw new Error(`vice_upscale failed: ${rc}`);
  }
  const bytes = new Uint8ClampedArray(
    c.HEAPU8.slice(pout, pout + ow * oh * 4).buffer as ArrayBuffer,
  );
  const residual: number = c._vice_last_residual();
  c._free(pin);
  c._free(pout);
  return { data: bytes, w: ow, h: oh, residual, ms: performance.now() - t0 };
}
