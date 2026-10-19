// Shared studio model: one job lifecycle, pixels cross once per transition.

export type Scale = 2 | 3 | 4 | 8;
export type ExportFormat = "png" | "webp" | "jpeg";

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

// Full scan (memoized per image by callers). Every alpha byte is inspected:
// sparse alpha (1px borders, tiny cutouts) must be reported, and the scan
// costs a few ms even at 2048². Callers memoize; everything else subsamples
// would risk silently wrong checker/JPEG compositing.
export function hasAlpha(img: StudioImage): boolean {
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] < 255) return true;
  }
  return false;
}
