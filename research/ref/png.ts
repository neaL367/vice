// Minimal PNG reader (ticket iter-5). Zero deps (node:zlib for inflate).
// Supports: 8-bit, non-interlaced, color types 0 (gray), 2 (RGB), 6 (RGBA),
// filters 0–4 (None/Sub/Up/Average/Paeth). Datasets only — not a general decoder.

import { inflateSync } from "node:zlib";

export interface PngImage {
  w: number;
  h: number;
  ch: 1 | 3 | 4;
  data: Uint8Array; // row-major, 0..255
}

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export function crc32(buf: Uint8Array): number {
  let table: Int32Array | null = (crc32 as unknown as { t?: Int32Array }).t ?? null;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    (crc32 as unknown as { t: Int32Array }).t = table;
  }
  let crc = -1;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

export function decodePng(buf: Uint8Array): PngImage {
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error("not a PNG");
  let pos = 8;
  let w = 0;
  let h = 0;
  let ch: 1 | 3 | 4 = 3;
  const idat: number[] = [];
  let seenIhdr = false;
  while (pos + 8 <= buf.length) {
    const len = u32(buf, pos);
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      if (len !== 13) throw new Error("bad IHDR");
      w = u32(data, 0);
      h = u32(data, 4);
      const depth = data[8];
      const ctype = data[9];
      if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw new Error("unsupported PNG (compression/filter/interlace)");
      if (ctype === 0) ch = 1;
      else if (ctype === 2) ch = 3;
      else if (ctype === 6) ch = 4;
      else throw new Error(`unsupported color type ${ctype}`);
      seenIhdr = true;
    } else if (type === "IDAT") {
      for (const b of data) idat.push(b);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (!seenIhdr || w === 0 || h === 0) throw new Error("missing IHDR");
  const raw = inflateSync(Buffer.from(idat));
  const bpp = ch;
  const stride = w * bpp;
  const out = new Uint8Array(w * h * ch);
  let p = 0;
  const prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const row = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const v = raw[p++];
      let r: number;
      switch (f) {
        case 0:
          r = v;
          break;
        case 1:
          r = v + a;
          break;
        case 2:
          r = v + b;
          break;
        case 3:
          r = v + ((a + b) >> 1);
          break;
        case 4: {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`unsupported filter ${f}`);
      }
      row[i] = r & 0xff;
    }
    out.set(row, y * stride);
    prev.set(row);
  }
  return { w, h, ch, data: out };
}
