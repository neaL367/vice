export type CompareMode = "split" | "side";
export type PixelMode = "auto" | "crisp" | "smooth";
export type ZoomPreset = "fit" | "1:1" | "2" | "4" | null;

export interface ViewportDimensions {
  width: number;
  height: number;
}
