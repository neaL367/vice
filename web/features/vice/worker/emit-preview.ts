// Preview accumulator: downsamples rendered bands into a bounded <=1600px preview buffer.

export class PreviewAccumulator {
  readonly pW: number;
  readonly pH: number;
  private readonly preview: Uint8Array;
  private readonly accSum: Float32Array;
  private accN = 0;
  private curPy = -1;

  constructor(
    readonly outW: number,
    readonly outH: number,
    maxDim = 1600,
  ) {
    let pw = outW;
    let ph = outH;
    if (pw > maxDim || ph > maxDim) {
      const k = Math.min(maxDim / pw, maxDim / ph);
      pw = Math.max(1, Math.round(pw * k));
      ph = Math.max(1, Math.round(ph * k));
    }
    this.pW = pw;
    this.pH = ph;
    this.preview = new Uint8Array(pw * ph * 4);
    this.accSum = new Float32Array(pw * 4);
  }

  feedBand(bytes: Uint8Array, startRow: number, rowCount: number): void {
    const { outW, outH, pW, pH, accSum, preview } = this;
    for (let r = 0; r < rowCount; r++) {
      const y = startRow + r;
      const py = Math.min(pH - 1, Math.floor((y * pH) / outH));
      if (py !== this.curPy) {
        this.flushPreviewRow(this.curPy);
        accSum.fill(0);
        this.accN = 0;
        this.curPy = py;
      }
      const rowOff = r * outW * 4;
      for (let px = 0; px < pW; px++) {
        const x0 = Math.floor((px * outW) / pW);
        const x1 = Math.max(x0 + 1, Math.floor(((px + 1) * outW) / pW));
        const n = x1 - x0;
        for (let c = 0; c < 4; c++) {
          let s = 0;
          for (let x = x0; x < x1; x++) s += bytes[rowOff + x * 4 + c];
          accSum[px * 4 + c] += s / n;
        }
      }
      this.accN++;
    }
  }

  finish(): void {
    this.flushPreviewRow(this.curPy);
  }

  async toBlob(): Promise<Blob> {
    this.finish();
    const cv = new OffscreenCanvas(this.pW, this.pH);
    const ctx = cv.getContext("2d");
    if (!ctx) throw new Error("preview context unavailable");
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(this.preview), this.pW, this.pH),
      0,
      0,
    );
    return await cv.convertToBlob({ type: "image/png" });
  }

  private flushPreviewRow(py: number): void {
    if (py < 0 || this.accN === 0) return;
    const base = py * this.pW * 4;
    for (let px = 0; px < this.pW; px++) {
      for (let c = 0; c < 4; c++) {
        this.preview[base + px * 4 + c] = Math.max(
          0,
          Math.min(255, Math.round(this.accSum[px * 4 + c] / this.accN)),
        );
      }
    }
  }
}
