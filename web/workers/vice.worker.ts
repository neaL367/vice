// vice worker: decode is done on main thread (createImageBitmap); heavy math
// runs here. Protocol: {type:"run", pixels, w, h, scale, id} → {type:"done", …}.
import { upscaleImage } from "../lib/engine";
import type { Scale } from "../features/studio/model";

export type RunMsg = {
  type: "run";
  id: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
  w: number;
  h: number;
  scale: Scale;
};

self.onmessage = async (ev: MessageEvent<RunMsg>) => {
  const msg = ev.data;
  if (msg.type !== "run") return;
  try {
    const r = await upscaleImage(msg.pixels, msg.w, msg.h, msg.scale);
    self.postMessage(
      { type: "done", id: msg.id, data: r.data, w: r.w, h: r.h, residual: r.residual, ms: r.ms },
      { transfer: [r.data.buffer] },
    );
  } catch (e) {
    self.postMessage({ type: "error", id: msg.id, message: String(e) });
  }
};
