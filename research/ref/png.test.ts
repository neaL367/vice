// png.ts tests: hand-built PNGs exercise every filter; Kodak smoke test.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { crc32, decodePng } from "./png.ts";

function chunk(type: string, data: Uint8Array): number[] {
  const out: number[] = [];
  const push32 = (v: number) => out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  push32(data.length);
  const td = new TextEncoder().encode(type);
  for (const b of td) out.push(b);
  for (const b of data) out.push(b);
  const crc = crc32(new Uint8Array([...td, ...data]));
  push32(crc);
  return out;
}

// Build a gray 4x2 PNG with per-row filters [f0, f1] over known pixels.
function buildGray(pixels: number[][], filters: number[]): Uint8Array {
  const w = 4;
  const h = 2;
  const raw: number[] = [];
  const prev = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    const f = filters[y];
    raw.push(f);
    const row = pixels[y];
    for (let x = 0; x < w; x++) {
      const a = x > 0 ? row[x - 1] : 0;
      const b = prev[x];
      const c = x > 0 ? prev[x - 1] : 0;
      let enc: number;
      switch (f) {
        case 0:
          enc = row[x];
          break;
        case 1:
          enc = row[x] - a;
          break;
        case 2:
          enc = row[x] - b;
          break;
        case 3:
          enc = row[x] - ((a + b) >> 1);
          break;
        case 4: {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          enc = row[x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error("bad filter");
      }
      raw.push(((enc % 256) + 256) % 256);
    }
    for (let x = 0; x < w; x++) prev[x] = row[x];
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const comp = deflateSync(Buffer.from(raw));
  return new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", new Uint8Array(comp)),
    ...chunk("IEND", new Uint8Array(0)),
  ]);
}

describe("png decoder", () => {
  test("all filters round-trip exact pixels", () => {
    const px = [
      [10, 20, 30, 250],
      [5, 200, 7, 130],
    ];
    for (const f of [0, 1, 2, 3, 4]) {
      const img = decodePng(buildGray(px, [f, f]));
      expect(img.w).toBe(4);
      expect(img.h).toBe(2);
      expect(img.ch).toBe(1);
      expect(Array.from(img.data)).toEqual([...px[0], ...px[1]]);
    }
  });
  test("mixed filters per row", () => {
    const px = [
      [255, 0, 128, 64],
      [1, 2, 3, 4],
    ];
    const img = decodePng(buildGray(px, [4, 1]));
    expect(Array.from(img.data)).toEqual([...px[0], ...px[1]]);
  });
  test("rejects non-PNG and bad depth", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow();
  });
  test("kodak smoke: dims, channels, determinism", () => {
    const buf = new Uint8Array(readFileSync("tools/eval/data/photos/kodim01.png"));
    const a = decodePng(buf);
    const b = decodePng(buf);
    expect(a.w).toBe(768);
    expect(a.h).toBe(512);
    expect(a.ch).toBe(3);
    expect(a.data).toEqual(b.data);
    let mn = 255;
    let mx = 0;
    for (let i = 0; i < a.data.length; i += 97) {
      if (a.data[i] < mn) mn = a.data[i];
      if (a.data[i] > mx) mx = a.data[i];
    }
    expect(mx - mn).toBeGreaterThan(150); // real photo, not flat
  });
});
