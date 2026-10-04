// Loader for the prebuilt C++ core (public/wasm/core.js, MODULARIZE ES6).
// Runtime URL by design: never bundled, loads only on the wasm path.
// Missing asset (dev without wasm build) -> null -> TS fallback in worker.

interface ViceCoreInstance {
  _vice_create(inW: number, inH: number, scale: number, channels: number): number;
  _vice_set_input(ctx: number, yPtr: number, n: number): number;
  _vice_submit_raw_tile(
    ctx: number,
    tx: number,
    ty: number,
    tilePtr: number,
    tw: number,
    th: number,
    n: number,
  ): number;
  _vice_upscale?(ctx: number): number;
  _vice_upscale_ex?(ctx: number, tuningPtr: number): number;
  _vice_tuning_defaults?(tuningPtr: number): void;
  _vice_project(ctx: number): number;
  _vice_download_raw(ctx: number, outPtr: number, n: number): number;
  _vice_process_band(ctx: number, band: number, outPtr: number, countPtr: number): number;
  _vice_finish_png(ctx: number, outPtr: number, cap: number, writtenPtr: number): number;
  _vice_set_icc_profile?(ctx: number, dataPtr: number, size: number): number;
  _vice_last_residual(ctx: number): number;
  _vice_destroy(ctx: number): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPF32: Float32Array;
  HEAPU8: Uint8Array;
}

type CoreFactory = () => Promise<ViceCoreInstance>;

export class ViceCore {
  private constructor(
    private readonly core: ViceCoreInstance,
    readonly outW: number,
    readonly outH: number,
    readonly channels: number,
  ) {}

  static async load(base: string): Promise<ViceCore | null> {
    try {
      // Runtime URL: left as-is by bundlers (turbopackIgnore) and bun build.
      const mod = (await import(/* turbopackIgnore: true */ `${base}wasm/core.js`)) as {
        default: CoreFactory;
      };
      const core = await mod.default();
      if (typeof core._vice_create !== "function") return null;
      // Deferred dims: set on create().
      return new ViceCore(core, 0, 0, 0);
    } catch {
      return null;
    }
  }

  private writeFloats(data: Float32Array): number {
    const ptr = this.core._malloc(data.length * 4);
    if (!ptr) throw new Error("wasm malloc failed");
    this.core.HEAPF32.set(data, ptr / 4);
    return ptr;
  }

  create(inW: number, inH: number, scale: number, channels: number): number {
    const ctx = this.core._vice_create(inW, inH, scale, channels);
    if (!ctx) throw new Error("vice_create failed (bad dims or OOM)");
    return ctx;
  }

  setInput(ctx: number, y: Float32Array): void {
    const ptr = this.writeFloats(y);
    try {
      if (this.core._vice_set_input(ctx, ptr, y.length) !== 0) throw new Error("vice_set_input failed");
    } finally {
      this.core._free(ptr);
    }
  }

  submitFullRaw(ctx: number, raw: Float32Array, outW: number, outH: number): void {
    const ptr = this.writeFloats(raw);
    try {
      if (this.core._vice_submit_raw_tile(ctx, 0, 0, ptr, outW, outH, raw.length) !== 0)
        throw new Error("vice_submit_raw_tile failed");
    } finally {
      this.core._free(ptr);
    }
  }

  hasNativeUpscale(): boolean {
    return typeof this.core._vice_upscale === "function";
  }

  upscale(
    ctx: number,
    options?: {
      preset?: "photo" | "smooth" | "pixel-art";
      dering?: number;
      sharpness?: number;
      shock?: number;
    },
  ): void {
    if (this.core._vice_upscale_ex && options) {
      const ptr = this.core._malloc(40);
      if (!ptr) throw new Error("wasm malloc failed");
      try {
        if (this.core._vice_tuning_defaults) {
          this.core._vice_tuning_defaults(ptr);
        }
        const view = new DataView(this.core.HEAPU8.buffer, ptr, 40);
        if (options.dering !== undefined) {
          view.setFloat32(24, Math.max(0, Math.min(1, options.dering)), true);
        }
        if (options.sharpness !== undefined) {
          view.setFloat32(28, Math.max(0, Math.min(1, options.sharpness)), true);
        }
        if (options.preset !== undefined) {
          const p =
            options.preset === "smooth"
              ? 1
              : options.preset === "pixel-art"
              ? 2
              : 0;
          view.setInt32(32, p, true);
        }
        if (options.shock !== undefined) {
          view.setFloat32(36, Math.max(0, Math.min(1, options.shock)), true);
        }
        if (this.core._vice_upscale_ex(ctx, ptr) !== 0) {
          throw new Error("vice_upscale_ex failed");
        }
        return;
      } finally {
        this.core._free(ptr);
      }
    }
    if (this.core._vice_upscale && this.core._vice_upscale(ctx) !== 0)
      throw new Error("vice_upscale failed");
  }

  project(ctx: number): void {
    if (this.core._vice_project(ctx) !== 0) throw new Error("vice_project failed");
  }

  downloadRaw(ctx: number, cells: number): Float32Array {
    const ptr = this.core._malloc(cells * 4);
    if (!ptr) throw new Error("wasm malloc failed");
    try {
      if (this.core._vice_download_raw(ctx, ptr, cells) !== 0)
        throw new Error("vice_download_raw failed");
      return this.core.HEAPF32.slice(ptr / 4, ptr / 4 + cells);
    } finally {
      this.core._free(ptr);
    }
  }

  lastResidual(ctx: number): number {
    return this.core._vice_last_residual(ctx);
  }

  setIccProfile(ctx: number, data: Uint8Array): void {
    if (!this.core._vice_set_icc_profile || data.length === 0) return;
    const ptr = this.core._malloc(data.length);
    if (!ptr) throw new Error("wasm malloc failed");
    try {
      this.core.HEAPU8.set(data, ptr);
      this.core._vice_set_icc_profile(ctx, ptr, data.length);
    } finally {
      this.core._free(ptr);
    }
  }

  processBand(ctx: number, band: number, outW: number, _maxRows: number, channels: number): Uint8Array {
    const bytes = 64 * outW * channels;
    const outPtr = this.core._malloc(bytes);
    const countPtr = this.core._malloc(4);
    if (!outPtr || !countPtr) throw new Error("wasm malloc failed");
    try {
      if (this.core._vice_process_band(ctx, band, outPtr, countPtr) !== 0)
        throw new Error("vice_process_band failed");
      const actualRows = new DataView(this.core.HEAPU8.buffer, countPtr, 4).getInt32(0, true);
      const writtenBytes = actualRows * outW * channels;
      const res = new Uint8Array(writtenBytes);
      res.set(this.core.HEAPU8.subarray(outPtr, outPtr + writtenBytes));
      return res;
    } finally {
      this.core._free(outPtr);
      this.core._free(countPtr);
    }
  }

  finishPng(ctx: number, outW: number, outH: number, channels: number): Uint8Array {
    const cap = outW * outH * channels + 1024 * 1024;
    const outPtr = this.core._malloc(cap);
    const writtenPtr = this.core._malloc(8);
    if (!outPtr || !writtenPtr) throw new Error("wasm malloc failed");
    try {
      const rc = this.core._vice_finish_png(ctx, outPtr, cap, writtenPtr);
      if (rc !== 0) throw new Error(`vice_finish_png failed (${rc})`);
      // size_t is 32-bit on wasm32. Access HEAPU8 fresh after potential memory growth.
      const heap = this.core.HEAPU8;
      const written = new DataView(heap.buffer, writtenPtr, 4).getUint32(0, true);
      const out = new Uint8Array(written);
      out.set(heap.subarray(outPtr, outPtr + written));
      return out;
    } finally {
      this.core._free(outPtr);
      this.core._free(writtenPtr);
    }
  }

  destroy(ctx: number): void {
    this.core._vice_destroy(ctx);
  }
}
