import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { insertIccpIntoPng } from "./helpers";

// Forced-streaming matrix: streamThresholdPx 0 routes tiny fixtures through
// the real strip pipeline (band push/pull, 8-bit accumulation, WASM PNG
// encode), proving the reassembly the bun parity tests cannot reach.

interface StreamProbeResult {
  outW: number;
  outH: number;
  residual: number;
  backend: string;
  w: number;
  h: number;
  data: number[];
  pngHasIccp: boolean;
}

type Fixture = "halves-bw" | "halves-alpha" | "gray";

let bundlePath = "";
let bundleDir = "";

test.beforeAll(() => {
  bundleDir = mkdtempSync(join(tmpdir(), "vice-stream-probe-"));
  bundlePath = join(bundleDir, "stream-probe-bundle.js");
  execSync(
    `bun build e2e/probe/stream-probe-entry.ts --outfile "${bundlePath}" --target browser --format iife --minify`,
    { cwd: join(__dirname, ".."), stdio: ["ignore", "pipe", "inherit"] },
  );
});

test.afterAll(() => {
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

async function runStreamed(
  page: Page,
  kind: Fixture,
  forgedIccpPng?: number[],
): Promise<StreamProbeResult> {
  await page.route("**/stream-probe-bundle.js", (r) => r.fulfill({ path: bundlePath }));
  await page.goto("/");
  await page.addScriptTag({ url: "/stream-probe-bundle.js" });
  return page.evaluate(
    ({ kind, forged }: { kind: Fixture; forged?: number[] }) => {
      const w = window as unknown as {
        __streamProbe: {
          runStream: (k: Fixture, f?: number[]) => Promise<StreamProbeResult>;
        };
      };
      if (!w.__streamProbe) throw new Error("stream probe bundle did not install");
      return w.__streamProbe.runStream(kind, forged);
    },
    { kind, forged: forgedIccpPng },
  );
}

test("streamed halves map to 16x16 flats with residual", async ({ page }) => {
  test.setTimeout(120_000);
  const r = await runStreamed(page, "halves-bw");
  expect(r.backend).toBe("Lanczos-3 stream");
  expect([r.outW, r.outH, r.w, r.h]).toEqual([16, 16, 16, 16]);
  expect(r.residual).toBeLessThan(1e-4);
  const colMean = (x0: number, x1: number): number => {
    let s = 0;
    let n = 0;
    for (let y = 0; y < r.h; y++)
      for (let x = x0; x < x1; x++) {
        s += r.data[(y * r.w + x) * 4];
        n++;
      }
    return s / n;
  };
  expect(colMean(0, 4)).toBeLessThanOrEqual(6);
  expect(colMean(12, 16)).toBeGreaterThanOrEqual(249);
});

test("streamed gray holds level and alpha stays exact", async ({ page }) => {
  test.setTimeout(120_000);
  const g = await runStreamed(page, "gray");
  expect(g.backend).toBe("Lanczos-3 stream");
  let sum = 0;
  for (let i = 0; i < g.data.length; i += 4) {
    expect(g.data[i]).toBeGreaterThanOrEqual(124);
    expect(g.data[i]).toBeLessThanOrEqual(132);
    expect(g.data[i + 3]).toBe(255);
    sum += g.data[i];
  }
  expect(sum / (g.data.length / 4)).toBeGreaterThanOrEqual(126);

  const a = await runStreamed(page, "halves-alpha");
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const av = a.data[(y * a.w + x) * 4 + 3];
      if (x < 6) expect(av).toBe(255);
      if (x > 9) expect(av).toBe(0);
    }
  }
});

test("streamed output carries forged iCCP through", async ({ page }) => {
  test.setTimeout(120_000);
  const raw = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    const x = c.getContext("2d")!;
    x.fillStyle = "#8030a0";
    x.fillRect(0, 0, 8, 8);
    const b: Blob = await new Promise((r) => c.toBlob((v) => r(v!), "image/png"));
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  const forged = [
    ...insertIccpIntoPng(
      Buffer.from(raw),
      Buffer.from("vice-fake-icc-profile-bytes-0123456789"),
    ),
  ];
  const r = await runStreamed(page, "gray", forged);
  expect(r.backend).toBe("Lanczos-3 stream");
  expect(r.pngHasIccp).toBe(true);
});
