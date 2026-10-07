// Shared studio model: one job lifecycle, pixels cross once per transition.

export interface StudioImage {
  data: Uint8ClampedArray<ArrayBuffer>;
  w: number;
  h: number;
}

export type Job =
  | { kind: "idle" }
  | { kind: "ready"; input: StudioImage; name: string }
  | { kind: "working"; input: StudioImage; name: string; scale: 2 | 3 | 4; startedAt: number }
  | {
      kind: "done";
      input: StudioImage;
      name: string;
      scale: 2 | 3 | 4;
      output: StudioImage;
      residual: number;
      ms: number;
    }
  | { kind: "error"; input: StudioImage | null; name: string; message: string };

export function hasAlpha(img: StudioImage): boolean {
  for (let i = 3; i < img.data.length; i += 64 * 4) {
    if (img.data[i] < 255) return true;
  }
  return false;
}
