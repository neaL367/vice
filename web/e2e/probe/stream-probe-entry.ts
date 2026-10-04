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
    preset: "photo",
    dering: 1.0,
    sharpness: 0.35,
    shock: 0.35,
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

(window as unknown as { __streamProbe: object }).__streamProbe = { runStream };
