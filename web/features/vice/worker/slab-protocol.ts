// Slab worker entry: share-nothing render host messages.
// Plain Workers only (no SAB, no COOP/COEP). Bundled to public/slab-worker.js.

export interface SlabRenderIncoming {
  type: "render";
  id: number;
  base: string;
  slab: { index: number; outY0: number; outRows: number };
  scale: 2 | 3 | 4;
  fused: 0 | 1 | 2;
  isLast: boolean;
  input: {
    width: number;
    height: number;
    pushCap: number;
    hasAlpha: boolean;
    icc: number[] | null;
    stripY0: number;
    strip: ArrayBuffer;
  };
}

export interface SlabWarmIncoming {
  type: "warm";
  base: string;
}

export interface SlabCloseIncoming {
  type: "close";
}

export type SlabIncoming = SlabRenderIncoming | SlabWarmIncoming | SlabCloseIncoming;

export interface SlabSegmentOutgoing {
  type: "segment";
  id: number;
  outY0: number;
  outRows: number;
  bytes: Uint8Array;
  segment: Uint8Array;
  adler: number;
  rawLen: number;
  residual: number;
  error?: undefined;
}

export interface SlabFailOutgoing {
  type: "segment";
  id: number;
  error: string;
}

export interface SlabReadyOutgoing {
  type: "ready";
}

export interface SlabFailBootOutgoing {
  type: "fail";
  message: string;
}

export type SlabOutgoing =
  | SlabSegmentOutgoing
  | SlabFailOutgoing
  | SlabReadyOutgoing
  | SlabFailBootOutgoing;
