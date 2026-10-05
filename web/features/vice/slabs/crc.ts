// CRC-32 (IEEE) and adler32_combine (zlib) for coordinator-side PNG framing.
// adlerCombine is cross-checked against vice_adler32_combine in slabs tests.

const TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let v = n;
  for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
  TABLE[n] = v >>> 0;
}

export function crc32(buf: Uint8Array, off: number, len: number): number {
  let v = 0xffffffff;
  for (let i = 0; i < len; i++) v = TABLE[(v ^ buf[off + i]) & 255] ^ (v >>> 8);
  return (v ^ 0xffffffff) >>> 0;
}

export function adlerCombine(ad1: number, ad2: number, len2: number): number {
  const BASE = 65521;
  const rem = len2 % BASE;
  let sum1 = ad1 & 0xffff;
  let sum2 = (rem * sum1) % BASE;
  sum1 += (ad2 & 0xffff) + BASE - 1;
  sum2 += ((ad1 >>> 16) & 0xffff) + ((ad2 >>> 16) & 0xffff) + BASE - rem;
  if (sum1 >= BASE) sum1 -= BASE;
  if (sum1 >= BASE) sum1 -= BASE;
  if (sum2 >= BASE * 2) sum2 -= BASE * 2;
  if (sum2 >= BASE) sum2 -= BASE;
  return ((sum1 | (sum2 << 16)) >>> 0);
}
