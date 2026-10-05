// Coordinator-side PNG assembly: ordered slab segments -> one valid PNG.
// sig + IHDR [+ iCCP] + IDATs (256 KB splits) + combined-adler trailer + IEND.
// Single zlib stream: one header up front, adler32_combine across segments.
// Async only because iCCP compression uses CompressionStream.

import { adlerCombine, crc32 } from "./crc";
import type { SlabSegment } from "../worker/render-slab";

const IDAT_SPLIT = 256 * 1024;

function put32(out: number[], v: number): void {
  out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
}

function chunk(out: number[], type: string, data: Uint8Array): void {
  put32(out, data.length);
  const crcStart = out.length;
  for (let i = 0; i < 4; i++) out.push(type.charCodeAt(i));
  for (let i = 0; i < data.length; i++) out.push(data[i]);
  const bytes = Uint8Array.from(out.slice(crcStart));
  put32(out, crc32(bytes, 0, bytes.length));
}

async function buildIccp(icc: Uint8Array): Promise<Uint8Array> {
  const name = new TextEncoder().encode("ICC Profile\0");
  const stream = new Blob([icc as unknown as BlobPart]).stream().pipeThrough(
    new CompressionStream("deflate"),
  );
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  const out = new Uint8Array(name.length + 1 + buf.length);
  out.set(name, 0);
  out[out.length - buf.length - 1] = 0; // compression method: deflate
  out.set(buf, out.length - buf.length);
  return out;
}

export interface AssembledPng {
  bytes: Uint8Array;
  adler: number;
  idatChunks: number;
}

/** Streaming framer pieces. Coordinator emits in order: fileHeader once,
 * then idatChunk() per payload (zlib header first), then adlerTrailer +
 * iend(). Same content as assemblePng, chunked incrementally. */
export async function fileHeader(
  outW: number,
  outH: number,
  outCh: 3 | 4,
  icc: Uint8Array | null,
): Promise<Uint8Array> {
  const out: number[] = [137, 80, 78, 71, 13, 10, 26, 10];
  const ihdr = new Uint8Array(13);
  ihdr[0] = (outW >>> 24) & 255;
  ihdr[1] = (outW >>> 16) & 255;
  ihdr[2] = (outW >>> 8) & 255;
  ihdr[3] = outW & 255;
  ihdr[4] = (outH >>> 24) & 255;
  ihdr[5] = (outH >>> 16) & 255;
  ihdr[6] = (outH >>> 8) & 255;
  ihdr[7] = outH & 255;
  ihdr[8] = 8;
  ihdr[9] = outCh === 4 ? 6 : 2;
  chunk(out, "IHDR", ihdr);
  if (icc && icc.length > 0) chunk(out, "iCCP", await buildIccp(icc));
  return Uint8Array.from(out);
}

/** Frame arbitrary deflate-stream bytes as IDAT chunks (256 KB splits). */
export function idatChunk(data: Uint8Array): { bytes: Uint8Array; chunks: number } {
  const out: number[] = [];
  let chunks = 0;
  for (let p = 0; p < data.length; p += IDAT_SPLIT) {
    chunk(out, "IDAT", data.subarray(p, Math.min(p + IDAT_SPLIT, data.length)));
    chunks++;
  }
  return { bytes: Uint8Array.from(out), chunks };
}

export function adlerTrailer(adler: number): Uint8Array {
  return new Uint8Array([(adler >>> 24) & 255, (adler >>> 16) & 255, (adler >>> 8) & 255, adler & 255]);
}

export function iendChunk(): Uint8Array {
  const out: number[] = [];
  chunk(out, "IEND", new Uint8Array(0));
  return Uint8Array.from(out);
}

export interface Receipt {
  v: 1;
  algo: 2;
  abi: number;
  scale: 2 | 3 | 4;
  policy: "direct" | "clean";
  operator: "box-encoded-exact";
  bandRows: number;
  slabBands: number;
  in: { w: number; h: number };
  out: { w: number; h: number };
  slab?: number;
  slabs?: number;
}

/** tEXt receipt chunk (keyword Vice-Receipt). Verifiable without Vice. */
export function receiptChunk(receipt: Receipt): Uint8Array {
  const keyword = new TextEncoder().encode("Vice-Receipt");
  const body = new TextEncoder().encode(JSON.stringify(receipt));
  const payload = new Uint8Array(keyword.length + 1 + body.length);
  payload.set(keyword, 0);
  payload[payload.length - body.length - 1] = 0;
  payload.set(body, payload.length - body.length);
  const out: number[] = [];
  chunk(out, "tEXt", payload);
  return Uint8Array.from(out);
}

export const ZLIB_HEADER = new Uint8Array([0x78, 0x9c]);

export async function assemblePng(
  outW: number,
  outH: number,
  outCh: 3 | 4,
  icc: Uint8Array | null,
  segments: SlabSegment[],
): Promise<AssembledPng> {
  if (segments.length === 0) throw new Error("assemblePng needs at least one segment");
  const ordered = [...segments].sort((a, b) => a.outY0 - b.outY0);
  let rows = 0;
  for (const s of ordered) {
    if (s.outY0 !== rows) throw new Error(`segment gap at ${rows}, got ${s.outY0}`);
    rows += s.outRows;
  }
  if (rows !== outH) throw new Error(`segments cover ${rows}/${outH} rows`);

  let adler = 1;
  let total = 2; // zlib header
  for (const s of ordered) {
    adler = adlerCombine(adler, s.adler, s.rawLen);
    total += s.segment.length;
  }
  total += 4; // trailer

  const stream = new Uint8Array(total);
  stream.set(ZLIB_HEADER, 0);
  let off = 2;
  for (const s of ordered) {
    stream.set(s.segment, off);
    off += s.segment.length;
  }
  stream.set(adlerTrailer(adler), off);

  const head = await fileHeader(outW, outH, outCh, icc);
  const framed = idatChunk(stream);
  const tail = iendChunk();
  const bytes = new Uint8Array(head.length + framed.bytes.length + tail.length);
  bytes.set(head, 0);
  bytes.set(framed.bytes, head.length);
  bytes.set(tail, head.length + framed.bytes.length);
  return { bytes, adler: adler >>> 0, idatChunks: framed.chunks };
}
