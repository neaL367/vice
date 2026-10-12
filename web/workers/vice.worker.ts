// vice worker: decode is done on main thread (createImageBitmap); heavy math
// runs here. Protocol: {type:"run", pixels, w, h, scale, id} → {type:"done", …},
// or {type:"burst", frames, w, h, scale, id} for multi-frame fusion.
import { upscaleBurst, upscaleImage, upscaleTile } from "../lib/engine";
import type { Scale } from "../features/studio/model";

export type RunMsg = {
  type: "run";
  id: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
  w: number;
  h: number;
  scale: Scale;
};

export type BurstMsg = {
  type: "burst";
  id: number;
  frames: Uint8ClampedArray<ArrayBuffer>[];
  w: number;
  h: number;
  scale: Scale;
};

export type TileMsg = {
  type: "tile";
  id: number;
  tileId: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
  pw: number;
  ph: number;
  scale: Exclude<Scale, 8>;
  ranges: Float64Array;
  vx0: number;
  vy0: number;
  vx1: number;
  vy1: number;
  px0: number;
  py0: number;
};

self.onmessage = async (ev: MessageEvent<RunMsg | BurstMsg | TileMsg>) => {
  const msg = ev.data;
  if (msg.type === "tile") {
    try {
      const r = await upscaleTile(
        msg.pixels,
        msg.pw,
        msg.ph,
        msg.scale,
        msg.ranges,
        msg.vx0,
        msg.vy0,
        msg.vx1,
        msg.vy1,
        msg.px0,
        msg.py0,
      );
      self.postMessage(
        {
          type: "tileDone",
          id: msg.id,
          tileId: msg.tileId,
          data: r.data,
          validW: r.validW,
          validH: r.validH,
          vx0: msg.vx0,
          vy0: msg.vy0,
          vx1: msg.vx1,
          vy1: msg.vy1,
          residual: r.residual,
        },
        { transfer: [r.data.buffer] },
      );
    } catch (e) {
      self.postMessage({ type: "error", id: msg.id, message: String(e) });
    }
    return;
  }
  if (msg.type === "burst") {
    try {
      const r = await upscaleBurst(msg.frames, msg.w, msg.h, msg.scale);
      self.postMessage(
        { type: "done", id: msg.id, data: r.data, w: r.w, h: r.h, residual: r.residual, ms: r.ms },
        { transfer: [r.data.buffer] },
      );
    } catch (e) {
      self.postMessage({ type: "error", id: msg.id, message: String(e) });
    }
    return;
  }
  if (msg.type !== "run") return;
  try {
    const r = await upscaleImage(msg.pixels, msg.w, msg.h, msg.scale, (done, total) =>
      self.postMessage({ type: "progress", id: msg.id, done, total }),
    );
    self.postMessage(
      { type: "done", id: msg.id, data: r.data, w: r.w, h: r.h, residual: r.residual, ms: r.ms },
      { transfer: [r.data.buffer] },
    );
  } catch (e) {
    self.postMessage({ type: "error", id: msg.id, message: String(e) });
  }
};
