"use client";

import { useEffect, useRef, useState } from "react";

type DoneMsg = {
  type: "done";
  id: number;
  data: Uint8ClampedArray<ArrayBuffer>;
  w: number;
  h: number;
  residual: number;
  ms: number;
};

export default function Page() {
  const [scale, setScale] = useState<2 | 3 | 4>(2);
  const [status, setStatus] = useState("Drop an image or choose a file. Everything runs locally.");
  const [facts, setFacts] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const inCanvas = useRef<HTMLCanvasElement>(null);
  const outCanvas = useRef<HTMLCanvasElement>(null);
  const idRef = useRef(0);
  const outRef = useRef<{ data: Uint8ClampedArray<ArrayBuffer>; w: number; h: number } | null>(null);

  useEffect(() => {
    workerRef.current = new Worker(new URL("../workers/vice.worker.ts", import.meta.url));
    return () => workerRef.current?.terminate();
  }, []);

  async function handleFile(f: File) {
    if (!workerRef.current || busy) return;
    setBusy(true);
    setFacts(null);
    setStatus("Decoding…");
    try {
      const bmp = await createImageBitmap(f);
      const maxIn = 2048;
      const k = Math.min(1, maxIn / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * k));
      const h = Math.max(1, Math.round(bmp.height * k));
      const off = new OffscreenCanvas(w, h);
      const ctx = off.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const ic = inCanvas.current!;
      ic.width = w;
      ic.height = h;
      ic.getContext("2d")!.putImageData(img, 0, 0);
      setStatus(`Upscaling ${w}×${h} at ${scale}x in worker…`);
      const id = ++idRef.current;
      const worker = workerRef.current;
      const done: DoneMsg = await new Promise((resolve, reject) => {
        const onMsg = (ev: MessageEvent) => {
          const m = ev.data;
          if (m.id !== id) return;
          worker.removeEventListener("message", onMsg);
          if (m.type === "error") reject(new Error(m.message));
          else resolve(m as DoneMsg);
        };
        worker.addEventListener("message", onMsg);
        worker.postMessage(
          { type: "run", id, pixels: img.data, w, h, scale },
          { transfer: [img.data.buffer] },
        );
      });
      const oc = outCanvas.current!;
      oc.width = done.w;
      oc.height = done.h;
      oc.getContext("2d")!.putImageData(new ImageData(done.data, done.w, done.h), 0, 0);
      outRef.current = { data: done.data, w: done.w, h: done.h };
      setFacts(
        `${done.w}×${done.h} · ${done.ms.toFixed(0)} ms · residual ${done.residual.toExponential(1)} · exact block sums`,
      );
      setStatus("Done. Everything stayed on this device.");
    } catch (e) {
      setStatus(`Failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const o = outRef.current;
    if (!o) return;
    const c = document.createElement("canvas");
    c.width = o.w;
    c.height = o.h;
    c.getContext("2d")!.putImageData(new ImageData(o.data, o.w, o.h), 0, 0);
    c.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `vice-${scale}x.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Vice</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>
        Deterministic enlargement. No AI, no uploads — WASM core, worker thread.
      </p>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <label>
          Scale{" "}
          <select
            value={scale}
            disabled={busy}
            onChange={(e) => setScale(Number(e.target.value) as 2 | 3 | 4)}
          >
            <option value={2}>2x</option>
            <option value={3}>3x</option>
            <option value={4}>4x</option>
          </select>
        </label>
        <button disabled={!outRef.current || busy} onClick={download}>
          Download PNG
        </button>
      </div>
      <p>{status}</p>
      {facts && <p style={{ fontFamily: "monospace" }}>{facts}</p>}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <figure style={{ margin: 0 }}>
          <figcaption>Input</figcaption>
          <canvas ref={inCanvas} style={{ maxWidth: "100%", border: "1px solid #444" }} />
        </figure>
        <figure style={{ margin: 0 }}>
          <figcaption>Output</figcaption>
          <canvas ref={outCanvas} style={{ maxWidth: "100%", border: "1px solid #444" }} />
        </figure>
      </div>
    </main>
  );
}
