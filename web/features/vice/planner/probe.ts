// probeImage: header sniff (no decode). Reads dimensions + format from the
// first bytes so the planner can reject hostile/oversize inputs before paying
// for createImageBitmap. Supports PNG, JPEG (SOF0/1/2), WebP (VP8/VP8L/VP8X).

export type ProbeFormat = "png" | "jpeg" | "webp";

export interface ImageProbe {
  format: ProbeFormat;
  w: number;
  h: number;
  bytes: number;
}

export class ProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProbeError";
  }
}

/** Core caps mirrored from vice_stream_create (reject before decode). */
export const PROBE_MAX_DIM = 100000;

function u16be(b: Uint8Array, o: number): number {
  return (b[o] * 256 + b[o + 1]) >>> 0;
}

function probePng(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 33) return null;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (b[i] !== sig[i]) return null;
  // IHDR must be first: length 13, type "IHDR".
  if (b[8] !== 0 || b[9] !== 0 || b[10] !== 0 || b[11] !== 13) return null;
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
  const w = (b[16] * 2 ** 24 + b[17] * 2 ** 16 + b[18] * 2 ** 8 + b[19]) >>> 0;
  const h = (b[20] * 2 ** 24 + b[21] * 2 ** 16 + b[22] * 2 ** 8 + b[23]) >>> 0;
  return { w, h };
}

function probeJpeg(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + 4 <= b.length) {
    if (b[pos] !== 0xff) return null;
    const marker = b[pos + 1];
    pos += 2;
    if (marker === 0xda) return null; // SOS: dims should have preceded it
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue; // standalone
    if (pos + 2 > b.length) return null;
    const len = u16be(b, pos);
    if (len < 2 || pos + len > b.length) return null;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (len < 7) return null;
      const h = u16be(b, pos + 3);
      const w = u16be(b, pos + 5);
      return { w, h };
    }
    pos += len;
  }
  return null;
}

function probeWebp(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 21) return null;
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WEBP") return null;
  const fourcc = tag(12);
  if (fourcc === "VP8 ") {
    // Lossy bitstream: 3-byte frame tag + 0x9d012a + 14-bit w-1/h-1 LE.
    if (b.length < 30) return null;
    if (b[20] !== 0x9d || b[21] !== 0x01 || b[22] !== 0x2a) return null;
    const w = (((b[24] << 8) | b[23]) & 0x3fff) + 1;
    const h = (((b[26] << 8) | b[25]) & 0x3fff) + 1;
    return { w, h };
  }
  if (fourcc === "VP8L") {
    if (b.length < 25) return null;
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    const w = (bits & 0x3fff) + 1;
    const h = ((bits >> 14) & 0x3fff) + 1;
    return { w, h };
  }
  if (fourcc === "VP8X") {
    if (b.length < 30) return null;
    const w = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
    const h = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
    return { w, h };
  }
  return null;
}

export function probeImage(bytes: Uint8Array): ImageProbe {
  if (!bytes || bytes.length < 21) throw new ProbeError(`too small to probe (${bytes?.length ?? 0} bytes)`);
  const png = probePng(bytes);
  if (png) return finish("png", png, bytes.length);
  const jpeg = probeJpeg(bytes);
  if (jpeg) return finish("jpeg", jpeg, bytes.length);
  const webp = probeWebp(bytes);
  if (webp) return finish("webp", webp, bytes.length);
  throw new ProbeError("unknown image format (need PNG, JPEG, or WebP)");
}

function finish(format: ProbeFormat, dims: { w: number; h: number }, bytes: number): ImageProbe {
  const { w, h } = dims;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    throw new ProbeError(`invalid dimensions ${w}x${h}`);
  }
  if (w > PROBE_MAX_DIM || h > PROBE_MAX_DIM) {
    throw new ProbeError(`dimensions ${w}x${h} exceed core cap ${PROBE_MAX_DIM}`);
  }
  return { format, w, h, bytes };
}
