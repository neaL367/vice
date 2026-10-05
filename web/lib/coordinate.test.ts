import { describe, expect, test } from "bun:test";
import { runCoordinatedJob } from "../features/vice/worker/coordinate";
import type { DecodedImage } from "../features/vice/worker/decode-input";
import type { DeviceFacts } from "../features/vice/planner/plan";
import { loadWasmModule } from "../features/vice/engine/wasm-module";
import { WasmMemory } from "../features/vice/engine/wasm-memory";
import { renderSlab } from "../features/vice/worker/render-slab";
import type { Slab } from "../features/vice/slabs/geometry";

function pngBytes(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([137, 80, 78, 71, 13, 10, 26, 10]);
  b[11] = 13;
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  b[16] = (w >>> 24) & 255;
  b[17] = (w >>> 16) & 255;
  b[18] = (w >>> 8) & 255;
  b[19] = w & 255;
  b[20] = (h >>> 24) & 255;
  b[21] = (h >>> 16) & 255;
  b[22] = (h >>> 8) & 255;
  b[23] = h & 255;
  b[24] = 8;
  b[25] = 2;
  return b;
}

function fakeDecoded(w: number, h: number, salt: number): DecodedImage {
  const data = new Float32Array(w * h * 4);
  for (let i = 0; i < data.length; i++) data[i] = ((i + salt) % 251) / 251;
  for (let i = 3; i < data.length; i += 4) data[i] = 1;
  return {
    width: w,
    height: h,
    icc: null,
    hasAlpha: false,
    getImageData: () => {
      throw new Error("unused in test");
    },
    getPremultipliedLinear: () => data,
    getLinearStrip: (y0: number, rows: number) => data.slice(y0 * w * 4, (y0 + rows) * w * 4),
    close: () => {},
  };
}

const DEVICE: DeviceFacts = {
  logicalCores: 8,
  deviceMemoryGB: 16,
  opfs: false,
  fileSystemAccess: false,
  storageFreeBytes: 100 * 2 ** 30,
};

async function runJob(workers: number, separateInstances: boolean, w = 24, h = 300): Promise<Uint8Array> {
  const file = new File([pngBytes(w, h) as unknown as BlobPart], "t.png", { type: "image/png" });
  const decoded = fakeDecoded(w, h, 7);
  const device: DeviceFacts = { ...DEVICE, logicalCores: workers };
  // Per-bucket WASM instances prove bytes don't depend on instance identity.
  const mems: WasmMemory[] = [];
  if (separateInstances) {
    for (let i = 0; i < workers; i++) {
      const loaded = await loadWasmModule("../public/");
      if (!loaded) throw new Error("no wasm");
      mems.push(new WasmMemory(loaded.instance));
    }
  }
  const slabInput = {
    width: decoded.width,
    height: decoded.height,
    channels: 4 as const,
    hasAlpha: decoded.hasAlpha,
    icc: decoded.icc,
    getLinearStrip: (y0: number, rows: number) => decoded.getLinearStrip(y0, rows),
  };
  const { blob } = await runCoordinatedJob({
    file,
    scale: 2,
    chained4x: false,
    preferSave: "blob",
    fileCount: 1,
    device,
    base: "../public/",
    target: { kind: "blob" },
    onProgress: () => {},
    decode: async () => decoded,
    makeRunner:
      workers === 1 && !separateInstances
        ? undefined
        : (_bucket: Slab[], index: number) => {
            const mem = separateInstances ? mems[index % mems.length] : null;
            if (!mem) return null; // shared-mem inline: scheduling still splits buckets
            return async (slab: Slab, isLast: boolean, sig?: AbortSignal) =>
              renderSlab(mem, slabInput, slab, 2, 0, isLast, sig);
          },
  });
  return new Uint8Array(await blob.arrayBuffer());
}

describe("coordinator", () => {
  test("K=1, K=4 shared-mem, K=4 separate instances: identical blob bytes", async () => {
    const a = await runJob(1, false);
    const b = await runJob(8, false);
    const c = await runJob(4, true);
    expect(a.length).toBeGreaterThan(100);
    expect(b.length).toBe(a.length);
    expect(c.length).toBe(a.length);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  test("over-budget estimate fails with numbers", async () => {
    const file = new File([pngBytes(24, 24) as unknown as BlobPart], "t.png", { type: "image/png" });
    await expect(
      runCoordinatedJob({
        file,
        scale: 2,
        chained4x: false,
        preferSave: "blob",
        fileCount: 1,
        device: { ...DEVICE, deviceMemoryGB: 2, storageFreeBytes: 1 },
        base: "../public/",
        target: { kind: "blob" },
        onProgress: () => {},
        decode: async () => fakeDecoded(24, 24, 1),
      }),
    ).rejects.toThrow(/storage|ceiling/);
  });

  test("planSlabs K assignment covers every slab once", async () => {
    const { planSlabs, assignSlabs } = await import("../features/vice/slabs/geometry");
    const geo = planSlabs(48, 1200, 2);
    const buckets = assignSlabs(geo.slabs, 4);
    const seen = buckets.flat().map((s) => s.outY0).sort((x: number, y: number) => x - y);
    expect(seen).toEqual(geo.slabs.map((s) => s.outY0));
  });
});
