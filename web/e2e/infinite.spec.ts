import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Infinite path through the REAL worker engine: band renderer ->
// incremental PNG writer -> chunk sink (no rgbaPtr, no Blob). The probe
// reassembles chunks exactly as the disk writer would, then decodes.
interface InfiniteProbeResult {
  outW: number;
  outH: number;
  residual: number;
  backend: string;
  w: number;
  h: number;
  data: number[];
  pngHasIccp: boolean;
  savedToDisk: boolean;
  fileBytes: number;
  previewW: number;
  previewH: number;
  threads: number;
}

type Fixture = "halves-bw" | "halves-alpha" | "gray";

let bundlePath = "";
let bundleDir = "";

test.beforeAll(() => {
  bundleDir = mkdtempSync(join(tmpdir(), "vice-infinite-probe-"));
  bundlePath = join(bundleDir, "stream-probe-bundle.js");
  execSync(
    `bun build e2e/probe/stream-probe-entry.ts --outfile "${bundlePath}" --target browser --format iife --minify`,
    { cwd: join(__dirname, ".."), stdio: ["ignore", "pipe", "inherit"] },
  );
});

test.afterAll(() => {
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

async function runInfinite(
  page: Page,
  kind: Fixture,
  scale: 2 | 4 = 2,
  chained4x = false,
): Promise<InfiniteProbeResult> {
  await page.route("**/stream-probe-bundle.js", (r) => r.fulfill({ path: bundlePath }));
  await page.goto("/");
  await page.addScriptTag({ url: "/stream-probe-bundle.js" });
  return page.evaluate(
    ({ kind, scale, chained }: { kind: Fixture; scale: 2 | 4; chained: boolean }) => {
      const w = window as unknown as {
        __streamProbe: {
          runInfinite: (k: Fixture, s: 2 | 4, c: boolean) => Promise<InfiniteProbeResult>;
        };
      };
      if (!w.__streamProbe?.runInfinite) throw new Error("infinite probe missing");
      return w.__streamProbe.runInfinite(kind, scale, chained);
    },
    { kind, scale, chained: chained4x },
  );
}

test("infinite halves decode to 16x16 flats with residual", async ({ page }) => {
  test.setTimeout(120_000);
  const r = await runInfinite(page, "halves-bw");
  expect(r.backend).toContain("infinite");
  expect(r.savedToDisk).toBe(true);
  expect(r.fileBytes).toBeGreaterThan(50);
  expect([r.outW, r.outH, r.w, r.h]).toEqual([16, 16, 16, 16]);
  expect(r.residual).toBeLessThan(1e-4);
  expect([r.previewW, r.previewH]).toEqual([16, 16]);
  // Threaded core engagement: isolated page + multi-core runner -> T2+.
  const cores = await page.evaluate(() => navigator.hardwareConcurrency ?? 1);
  expect(r.threads).toBeGreaterThanOrEqual(cores > 1 ? 2 : 1);
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

test("infinite preserves alpha and prunes opaque to RGB", async ({ page }) => {
  test.setTimeout(120_000);
  const g = await runInfinite(page, "gray");
  expect(g.backend).toContain("infinite");
  // Opaque input -> RGB writer: strictly fewer bytes than the RGBA path.
  const a = await runInfinite(page, "halves-alpha");
  expect(a.backend).toContain("infinite");
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const av = a.data[(y * a.w + x) * 4 + 3];
      if (x < 6) expect(av).toBe(255);
      if (x > 9) expect(av).toBe(0);
    }
  }
  expect(g.fileBytes).toBeLessThan(a.fileBytes);
});

test("infinite fused 4x renders exact dims with residual", async ({ page }) => {
  test.setTimeout(180_000);
  const r = await runInfinite(page, "halves-bw", 4, true);
  expect(r.backend).toContain("2×2×");
  expect(r.savedToDisk).toBe(true);
  expect([r.outW, r.outH, r.w, r.h]).toEqual([32, 32, 32, 32]);
  expect(r.residual).toBeLessThan(1e-4);
});
