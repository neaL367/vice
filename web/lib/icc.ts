// icc.ts — Extract raw ICC profiles from input images (PNG, JPEG, WebP)
// to pass through to the lossless PNG output.

/**
 * Extracts raw, uncompressed ICC profile bytes from an image file buffer.
 * Supports JPEG (APP2 ICC_PROFILE), WebP (ICCP chunk), and PNG (iCCP chunk).
 */
export async function extractIccProfile(
  buffer: ArrayBuffer | Uint8Array,
): Promise<Uint8Array | null> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 16) return null;

  // 1. JPEG: Check SOI marker 0xFF 0xD8
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return extractJpegIcc(bytes);
  }

  // 2. PNG: Check signature 137, 80, 78, 71, 13, 10, 26, 10
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return extractPngIcc(bytes);
  }

  // 3. WebP: Check RIFF....WEBP
  if (
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return extractWebpIcc(bytes);
  }

  return null;
}

/**
 * Extracts ICC profile from JPEG APP2 marker segments.
 */
function extractJpegIcc(bytes: Uint8Array): Uint8Array | null {
  const marker = [
    0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00,
  ]; // "ICC_PROFILE\0"
  let offset = 2; // skip 0xFF 0xD8
  const chunks: { seq: number; total: number; data: Uint8Array }[] = [];

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const tag = bytes[offset + 1];
    offset += 2;

    // Standalone markers without length
    if (tag === 0xd8 || tag === 0xd9 || (tag >= 0xd0 && tag <= 0xd7) || tag === 0x01) {
      continue;
    }
    // SOS marker indicates start of compressed scan data
    if (tag === 0xda) break;

    if (offset + 2 > bytes.length) break;
    const segLen = (bytes[offset] << 8) | bytes[offset + 1];
    if (segLen < 2 || offset + segLen > bytes.length) break;

    // APP2 marker
    if (tag === 0xe2 && segLen >= 16) {
      const segPayload = bytes.subarray(offset + 2, offset + segLen);
      let match = true;
      for (let i = 0; i < 12; i++) {
        if (segPayload[i] !== marker[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        const seq = segPayload[12];
        const total = segPayload[13];
        const data = segPayload.subarray(14);
        chunks.push({ seq, total, data });
      }
    }

    offset += segLen;
  }

  if (chunks.length === 0) return null;
  chunks.sort((a, b) => a.seq - b.seq);
  const totalLen = chunks.reduce((sum, c) => sum + c.data.length, 0);
  const out = new Uint8Array(totalLen);
  let writeOffset = 0;
  for (const c of chunks) {
    out.set(c.data, writeOffset);
    writeOffset += c.data.length;
  }
  return out;
}

/**
 * Extracts and decompresses ICC profile from PNG iCCP chunk.
 */
async function extractPngIcc(bytes: Uint8Array): Promise<Uint8Array | null> {
  let offset = 8; // skip 8-byte PNG signature
  while (offset + 8 <= bytes.length) {
    const len =
      ((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>>
      0;
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    offset += 12 + len; // 4 len + 4 type + len data + 4 crc

    if (type === "iCCP" && dataStart + len <= bytes.length) {
      // Structure: profile name (1-79 bytes) + null byte + compression method (1 byte, 0=deflate) + compressed data
      let nullIdx = dataStart;
      while (nullIdx < dataStart + len && bytes[nullIdx] !== 0) {
        nullIdx++;
      }
      if (nullIdx + 2 < dataStart + len) {
        const compressedData = bytes.subarray(nullIdx + 2, dataStart + len);
        try {
          if (typeof DecompressionStream !== "undefined") {
            const ds = new DecompressionStream("deflate");
            const writer = ds.writable.getWriter();
            writer.write(compressedData as unknown as BufferSource);
            writer.close();
            const response = new Response(ds.readable);
            const ab = await response.arrayBuffer();
            return new Uint8Array(ab);
          }
        } catch {
          // Fallback if decompression fails
        }
      }
    }
    if (type === "IEND" || type === "IDAT") break;
  }
  return null;
}

/**
 * Extracts ICC profile from WebP ICCP chunk.
 */
function extractWebpIcc(bytes: Uint8Array): Uint8Array | null {
  let offset = 12; // skip RIFF + size + WEBP
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    );
    const len =
      bytes[offset + 4] |
      (bytes[offset + 5] << 8) |
      (bytes[offset + 6] << 16) |
      (bytes[offset + 7] << 24);
    const dataStart = offset + 8;
    offset += 8 + len + (len % 2); // padded to even bytes

    if (type === "ICCP" && dataStart + len <= bytes.length) {
      return bytes.subarray(dataStart, dataStart + len);
    }
  }
  return null;
}
