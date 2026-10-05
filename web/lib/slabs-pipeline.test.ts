import { describe, expect, test } from "bun:test";
import { loadWasmModule } from "../features/vice/engine/wasm-module";
import { WasmMemory } from "../features/vice/engine/wasm-memory";
import { adlerCombine, crc32 } from "../features/vice/slabs/crc";
import { assemblePng } from "../features/vice/slabs/assemble";
import { planSlabs } from "../features/vice/slabs/geometry";
import { renderSlab } from "../features/vice/worker/render-slab";
import type { SlabInput } from "../features/vice/worker/render-slab";

async function loadMem(): Promise<WasmMemory> {
  const loaded = await loadWasmModule("../public/");
  expect(loaded).toBeTruthy();
  if (!loaded) throw new Error("no wasm core");
  return new WasmMemory(loaded.instance);
}

function fakeInput(w: number, h: number, salt: number): SlabInput {
  const data = new Float32Array(w * h * 4);
  for (let i = 0; i < data.length; i++) data[i] = ((i + salt) % 251) / 251;
  for (let i = 3; i < data.length; i += 4) data[i] = 1;
  return {
    width: w,
    height: h,
    channels: 4,
    hasAlpha: false,
    icc: null,
    getLinearStrip(y0: number, rows: number): Float32Array {
      return data.slice(y0 * w * 4, (y0 + rows) * w * 4);
    },
  };
}

function adlerOf(part: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < part.length; i++) {
    a = (a + part[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

describe("slab pipeline", () => {
  test("crc32 matches known vector", () => {
    const data = new TextEncoder().encode("123456789");
    expect(crc32(data, 0, data.length)).toBe(0xcbf43926);
  });

  test("adlerCombine matches reference and WASM on random splits", async () => {
    const mem = await loadMem();
    const fn = mem.instance._vice_adler32_combine;
    expect(typeof fn).toBe("function");
    if (!fn) return;
    let seed = 12345;
    const rnd = () => {
      // 32-bit LCG via imul: plain * overflows 2^53 and corrupts values.
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return (seed >>> 8) / 2 ** 24; // [0, 1)
    };
    for (let t = 0; t < 8; t++) {
      const n = 1 + Math.floor(rnd() * 500);
      const cut = Math.floor(rnd() * (n + 1));
      const data = new Uint8Array(n);
      for (let i = 0; i < n; i++) data[i] = Math.floor(rnd() * 256);
      const want = adlerOf(data);
      const ad1 = adlerOf(data.slice(0, cut));
      const ad2 = adlerOf(data.slice(cut));
      expect(adlerCombine(ad1, ad2, n - cut)).toBe(want);
      expect(fn(ad1, ad2, n - cut) >>> 0).toBe(want);
    }
  });

  test("slabs assemble to a decodable PNG equal to owned bytes", async () => {
    const { inflateSync } = await import("node:zlib");
    const mem = await loadMem();
    const w = 24;
    const h = 300;
    const scale = 2 as const;
    const input = fakeInput(w, h, 7);
    const W = w * scale;
    const H = h * scale;
    const OC = 3; // hasAlpha=false prunes to RGB
    const geo = planSlabs(W, H, scale);
    expect(geo.slabs.length).toBeGreaterThan(1);

    const segments = [];
    const owned: Uint8Array[] = [];
    for (let i = 0; i < geo.slabs.length; i++) {
      const r = renderSlab(mem, input, geo.slabs[i], scale, 0, i === geo.slabs.length - 1);
      segments.push(r);
      owned.push(r.bytes);
      expect(r.outRows).toBe(geo.slabs[i].outRows);
      expect(r.residual).toBeLessThan(1e-4);
    }
    const flat = new Uint8Array(W * H * OC);
    let off = 0;
    for (const o of owned) {
      for (let i = 0; i < o.length; i += 4) {
        flat[off++] = o[i];
        flat[off++] = o[i + 1];
        flat[off++] = o[i + 2];
      }
    }
    expect(off).toBe(flat.length);

    const png = await assemblePng(W, H, OC, null, segments);
    expect(png.bytes[0]).toBe(137);
    const rd32 = (o: number) =>
      (png.bytes[o] * 2 ** 24 + png.bytes[o + 1] * 2 ** 16 + png.bytes[o + 2] * 2 ** 8 + png.bytes[o + 3]) >>> 0;
    let pos = 8;
    let lastType = "";
    const idat = new Uint8Array(png.bytes.length);
    let idatLen = 0;
    while (pos + 8 <= png.bytes.length) {
      const n = rd32(pos);
      const type = String.fromCharCode(
        png.bytes[pos + 4],
        png.bytes[pos + 5],
        png.bytes[pos + 6],
        png.bytes[pos + 7],
      );
      expect(crc32(png.bytes, pos + 4, 4 + n)).toBe(rd32(pos + 8 + n));
      if (type === "IHDR") {
        expect(rd32(16)).toBe(W);
        expect(rd32(20)).toBe(H);
      }
      if (type === "IDAT") {
        idat.set(png.bytes.slice(pos + 8, pos + 8 + n), idatLen);
        idatLen += n;
      }
      lastType = type;
      pos += 12 + n;
    }
    expect(lastType).toBe("IEND");
    expect(pos).toBe(png.bytes.length);

    // Inflate + full unfilter (all 5 filters) == owned bytes.
    const raw = inflateSync(idat.slice(0, idatLen));
    const stride = W * OC;
    expect(raw.length).toBe((stride + 1) * H);
    const prev = new Uint8Array(stride);
    const cur = new Uint8Array(stride);
    const decoded = new Uint8Array(W * H * OC);
    for (let y = 0; y < H; y++) {
      const f = raw[y * (stride + 1)];
      const row = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      for (let i = 0; i < stride; i++) {
        const a = i >= OC ? cur[i - OC] : 0;
        const b = prev[i];
        const cc = i >= OC ? prev[i - OC] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const p = a + b - cc;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - cc);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc;
        }
        cur[i] = (row[i] + pred) & 255;
      }
      decoded.set(cur, y * stride);
      prev.set(cur);
    }
    expect(decoded).toEqual(flat);

    // Gap detection + ICC embedding on the same segments.
    await expect(assemblePng(W, H, OC, null, segments.slice(1))).rejects.toThrow(/gap/);
    const icc = new Uint8Array([0, 1, 2, 3, 9, 9, 9, 9]);
    const withIcc = await assemblePng(W, H, OC, icc, segments);
    let found = false;
    for (let i = 0; i + 4 <= withIcc.bytes.length; i++) {
      if (
        withIcc.bytes[i] === 0x69 &&
        withIcc.bytes[i + 1] === 0x43 &&
        withIcc.bytes[i + 2] === 0x43 &&
        withIcc.bytes[i + 3] === 0x50
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});
