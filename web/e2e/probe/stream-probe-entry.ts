// Bundled at test time (bun build) and served via page.route; never shipped.
// Calls the REAL runViceUpscale with streaming forced (streamThresholdPx: 0)
// so the suite exercises the strip pipeline + PNG reassembly on tiny
// fixtures instead of 30 MP uploads.
import { runViceUpscale } from "../../features/vice/vice.worker";

export interface StreamProbeResult {
  outW: number;
  outH: number;
  residual: number;
  backend: string;
  w: number;
  h: number;
  data: number[];
  pngHasIccp: boolean;
}

async function paint(
  kind: "halves-bw" | "halves-alpha" | "gray",
): Promise<{ bytes: number[]; mime: string; name: string }> {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 8;
  const x = c.getContext("2d")!;
  if (kind === "halves-bw") {
    x.fillStyle = "#000000";
    x.fillRect(0, 0, 4, 8);
    x.fillStyle = "#ffffff";
    x.fillRect(4, 0, 4, 8);
  } else if (kind === "halves-alpha") {
    x.clearRect(0, 0, 8, 8);
    x.fillStyle = "#c02020";
    x.fillRect(0, 0, 4, 8);
  } else {
    x.fillStyle = "#808080";
    x.fillRect(0, 0, 8, 8);
  }
  const b: Blob = await new Promise((r) => c.toBlob((v) => r(v!), "image/png"));
  return { bytes: [...new Uint8Array(await b.arrayBuffer())], mime: "image/png", name: `${kind}.png` };
}

export async function runStream(
  kind: "halves-bw" | "halves-alpha" | "gray",
  forgedIccpPng?: number[],
): Promise<StreamProbeResult> {
  const input = forgedIccpPng
    ? { bytes: forgedIccpPng, mime: "image/png", name: "icc.png" }
    : await paint(kind);
  const file = new File([new Uint8Array(input.bytes)], input.name, { type: input.mime });
  const { blob, meta } = await runViceUpscale(file, 2, () => {}, {
    base: "/",
    streamThresholdPx: 0,
  });
  const raw = new Uint8Array(await blob.arrayBuffer());
  const tag = [0x69, 0x43, 0x43, 0x50];
  let pngHasIccp = false;
  for (let i = 0; i + 4 <= raw.length; i++) {
    if (raw[i] === tag[0] && raw[i + 1] === tag[1] && raw[i + 2] === tag[2] && raw[i + 3] === tag[3]) {
      pngHasIccp = true;
      break;
    }
  }
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement("canvas");
  cv.width = bmp.width;
  cv.height = bmp.height;
  const ctx = cv.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height);
  bmp.close();
  return {
    outW: meta.outW,
    outH: meta.outH,
    residual: meta.residual,
    backend: meta.backend,
    w: cv.width,
    h: cv.height,
    data: [...d.data],
    pngHasIccp,
  };
}

export interface InfiniteProbeResult extends StreamProbeResult {
  savedToDisk: boolean;
  fileBytes: number;
  previewW: number;
  previewH: number;
  threads: number;
}

export async function runInfinite(
  kind: "halves-bw" | "halves-alpha" | "gray",
  scale: 2 | 4 = 2,
  chained4x = false,
): Promise<InfiniteProbeResult> {
  const input = await paint(kind);
  const file = new File([new Uint8Array(input.bytes)], input.name, { type: input.mime });
  const chunks: Uint8Array[] = [];
  const { blob, meta } = await runViceUpscale(file, scale, () => {}, {
    base: "/",
    streamThresholdPx: 0,
    chained4x,
    sink: {
      write: async (chunk: Uint8Array) => {
        chunks.push(chunk.slice());
      },
    },
  });
  // Reassemble the streamed file exactly as the disk writer would.
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const fileBytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    fileBytes.set(c, off);
    off += c.length;
  }
  const fileBlob = new Blob([fileBytes as unknown as BlobPart], { type: "image/png" });
  const tag = [0x69, 0x43, 0x43, 0x50];
  let pngHasIccp = false;
  for (let i = 0; i + 4 <= fileBytes.length; i++) {
    if (
      fileBytes[i] === tag[0] &&
      fileBytes[i + 1] === tag[1] &&
      fileBytes[i + 2] === tag[2] &&
      fileBytes[i + 3] === tag[3]
    ) {
      pngHasIccp = true;
      break;
    }
  }
  const bmp = await createImageBitmap(fileBlob);
  const cv = document.createElement("canvas");
  cv.width = bmp.width;
  cv.height = bmp.height;
  const ctx = cv.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height);
  bmp.close();
  // Preview blob decodes too (small product, not the file).
  const pvBmp = await createImageBitmap(blob);
  const previewW = pvBmp.width;
  const previewH = pvBmp.height;
  pvBmp.close();
  return {
    outW: meta.outW,
    outH: meta.outH,
    residual: meta.residual,
    backend: meta.backend,
    w: cv.width,
    h: cv.height,
    data: [...d.data],
    pngHasIccp,
    savedToDisk: !!meta.savedToDisk,
    fileBytes: meta.fileBytes ?? total,
    previewW,
    previewH,
    threads: meta.threads ?? 1,
  };
}

export interface InfiniteFileResult {
  outW: number;
  outH: number;
  backend: string;
  residual: number;
  savedToDisk: boolean;
  chunks: number;
  fileBytes: number;
  pngOk: boolean;
  idatChunks: number;
  idatBytes: number;
  wallMs: number;
  heapDelta: number;
  previewW: number;
  previewH: number;
  threads: number;
}

// Large-file proof entry: caller supplies the File; chunks are validated
// structurally (never decoded: a 100MP bitmap would defeat the point).
export async function runInfiniteFile(
  file: File,
  scale: 2 | 4,
  chained4x: boolean,
): Promise<InfiniteFileResult> {
  const chunks: Uint8Array[] = [];
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
  const heap0 = perf.memory?.usedJSHeapSize ?? 0;
  const t0 = performance.now();
  const { blob, meta } = await runViceUpscale(file, scale, () => {}, {
    base: "/",
    chained4x,
    sink: {
      write: async (chunk: Uint8Array) => {
        chunks.push(chunk.slice());
      },
    },
  });
  const wallMs = Math.round(performance.now() - t0);
  const heapDelta = (perf.memory?.usedJSHeapSize ?? 0) - heap0;
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    png.set(c, off);
    off += c.length;
  }
  // Structural walk: sig, IHDR dims, every CRC, IEND last.
  const rd32 = (o: number) =>
    (png[o] * 2 ** 24 + png[o + 1] * 2 ** 16 + png[o + 2] * 2 ** 8 + png[o + 3]) >>> 0;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let v = n;
    for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
    table[n] = v >>> 0;
  }
  const crc = (o: number, n: number): number => {
    let v = 0xffffffff;
    for (let i = 0; i < n; i++) v = table[(v ^ png[o + i]) & 255] ^ (v >>> 8);
    return (v ^ 0xffffffff) >>> 0;
  };
  let pngOk = png.length > 8 && png[0] === 137 && png[1] === 0x50;
  let pos = 8;
  let idatChunks = 0;
  let idatBytes = 0;
  let lastType = "";
  while (pngOk && pos + 8 <= png.length) {
    const n = rd32(pos);
    if (n > 16 * 1024 * 1024 || pos + 12 + n > png.length) {
      pngOk = false;
      break;
    }
    const type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    if (crc(pos + 4, 4 + n) !== rd32(pos + 8 + n)) {
      pngOk = false;
      break;
    }
    if (pos === 8) {
      pngOk =
        type === "IHDR" && n === 13 && rd32(16) === meta.outW && rd32(20) === meta.outH;
    }
    if (type === "IDAT") {
      idatChunks++;
      idatBytes += n;
    }
    lastType = type;
    pos += 12 + n;
    if (type === "IEND") break;
  }
  pngOk = pngOk && lastType === "IEND" && pos === png.length;
  const pv = await createImageBitmap(blob);
  const previewW = pv.width;
  const previewH = pv.height;
  pv.close();
  return {
    outW: meta.outW,
    outH: meta.outH,
    backend: meta.backend,
    residual: meta.residual,
    savedToDisk: !!meta.savedToDisk,
    chunks: chunks.length,
    fileBytes: total,
    pngOk,
    idatChunks,
    idatBytes,
    wallMs,
    heapDelta,
    previewW,
    previewH,
    threads: meta.threads ?? 1,
  };
}

(window as unknown as { __streamProbe: object }).__streamProbe = {
  runStream,
  runInfinite,
  runInfiniteFile,
};
