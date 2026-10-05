// Fixed slab geometry: boundaries depend only on image size and scale,
// never on worker count — so bytes never depend on K either. A slab is a
// run of whole bands (bandRows each); the last slab may be partial.

export interface Slab {
  index: number;
  outY0: number;
  outRows: number;
}

export interface SlabGeometry {
  slabs: Slab[];
  bandRows: number;
  slabBands: number;
  outW: number;
  outH: number;
}

export function planSlabs(
  outW: number,
  outH: number,
  scale: 2 | 3 | 4,
  bandRows = 64,
  slabBands = 8,
): SlabGeometry {
  if (!Number.isInteger(outW) || !Number.isInteger(outH) || outW <= 0 || outH <= 0) {
    throw new Error(`bad output dims ${outW}x${outH}`);
  }
  if (!Number.isInteger(bandRows) || bandRows <= 0 || !Number.isInteger(slabBands) || slabBands <= 0) {
    throw new Error(`bad slab shape bandRows=${bandRows} slabBands=${slabBands}`);
  }
  // Slab rows rounded UP to a multiple of scale: box blocks must align, so a
  // slab never ends mid-block (which would leave trailing rows unprojected).
  // Still a pure function of (image, scale): geometry never depends on K.
  const slabRows = Math.ceil((bandRows * slabBands) / scale) * scale;
  const slabs: Slab[] = [];
  let y = 0;
  let index = 0;
  while (y < outH) {
    const rows = Math.min(slabRows, outH - y);
    slabs.push({ index: index++, outY0: y, outRows: rows });
    y += rows;
  }
  return { slabs, bandRows, slabBands, outW, outH };
}

/** Split slabs across K workers round-robin (order preserved per worker). */
export function assignSlabs(slabs: Slab[], workers: number): Slab[][] {
  const k = Math.max(1, Math.floor(workers) || 1);
  const buckets: Slab[][] = Array.from({ length: k }, () => []);
  slabs.forEach((s, i) => buckets[i % k].push(s));
  return buckets;
}
