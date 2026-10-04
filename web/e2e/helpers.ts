import { deflateSync } from "node:zlib";

// Forged-metadata helpers (Node side): canvas output carries no ICC/EXIF,
// so tests splice real chunks into real encoder bytes — PNG iCCP before
// IDAT, JPEG APP1 Exif after SOI.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  td.copy(out, 4);
  out.writeUInt32BE(crc32(td), 8 + data.length);
  return out;
}

/** Insert an iCCP chunk (deflated fake profile) before the first IDAT. */
export function insertIccpIntoPng(png: Buffer, profile: Buffer): Buffer {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  const payload = Buffer.concat([
    Buffer.from("vice\0", "ascii"),
    Buffer.from([0]),
    deflateSync(profile),
  ]);
  const iccp = pngChunk("iCCP", payload);
  let off = 8;
  while (off + 8 <= png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString("ascii");
    if (type === "IDAT") {
      return Buffer.concat([png.subarray(0, off), iccp, png.subarray(off)]);
    }
    if (type === "IEND") throw new Error("PNG has no IDAT");
    off += 12 + len;
  }
  throw new Error("truncated PNG");
}

/** Insert APP1 Exif with orientation=6 (rotate 90 CW) right after SOI. */
export function insertExifOrientation6(jpeg: Buffer): Buffer {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("not a JPEG");
  const tiff = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // II*\0, IFD at 8
    0x01, 0x00, // 1 entry
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, // tag 0x0112 SHORT×1
    0x06, 0x00, 0x00, 0x00, // value 6
    0x00, 0x00, 0x00, 0x00, // next IFD none
  ]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const seg = Buffer.alloc(2 + 2 + payload.length);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  seg.writeUInt16BE(payload.length + 2, 2);
  payload.copy(seg, 4);
  return Buffer.concat([jpeg.subarray(0, 2), seg, jpeg.subarray(2)]);
}

export function pngDimensions(png: Buffer): { w: number; h: number } {
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}

export function bufferHasTag(buf: Buffer, tag: string): boolean {
  const t = Buffer.from(tag, "ascii");
  return buf.indexOf(t) !== -1;
}
