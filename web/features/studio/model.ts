// Shared studio model: one job lifecycle, pixels cross once per transition.

export type Scale = 2 | 3 | 4 | 8;

export interface StudioImage {
  data: Uint8ClampedArray<ArrayBuffer>;
  w: number;
  h: number;
}

export type Job =
  | { kind: "idle" }
  | { kind: "ready"; input: StudioImage; name: string; frames: StudioImage[] | null }
  | { kind: "working"; input: StudioImage; name: string; frames: StudioImage[] | null; scale: Scale; startedAt: number; progress: { done: number; total: number } | null }
  | {
      kind: "done";
      input: StudioImage;
      name: string;
      frames: StudioImage[] | null;
      scale: Scale;
      output: StudioImage;
      residual: number;
      ms: number;
    }
  | { kind: "error"; input: StudioImage | null; name: string; frames: StudioImage[] | null; message: string };

export function hasAlpha(img: StudioImage): boolean {
  for (let i = 3; i < img.data.length; i += 64 * 4) {
    if (img.data[i] < 255) return true;
  }
  return false;
}
