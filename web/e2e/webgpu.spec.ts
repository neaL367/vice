import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// WebGPU-only quality matrix. The WebGPU route is a degraded fallback
// (box-only projection, no multigrid; no ICC embedding), so this file
// guards against total divergence rather than asserting WASM parity.
// Skips cleanly where no adapter exists (e.g. headless CI here).
// Thresholds are provisional: tighten on real-GPU CI after measuring.

interface WebGPUCaseResult {
  outW: number;
  outH: number;
  residual: number;
  leftMean: number;
  rightMean: number;
  alphaOk: boolean;
  refMeanAbsDiff: number;
}

interface WebGPUProbe {
  isSupported: () => Promise<boolean>;
  runMatrix: () => Promise<Record<string, WebGPUCaseResult>>;
}

let bundlePath = "";
let bundleDir = "";

test.beforeAll(() => {
  bundleDir = mkdtempSync(join(tmpdir(), "vice-webgpu-probe-"));
  bundlePath = join(bundleDir, "webgpu-probe-bundle.js");
  execSync(
    `bun build e2e/probe/webgpu-probe-entry.ts --outfile "${bundlePath}" --target browser --format iife --minify`,
    { cwd: join(__dirname, ".."), stdio: ["ignore", "pipe", "inherit"] },
  );
});

test.afterAll(() => {
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

/** Installs the probe bundle; returns true when a WebGPU adapter exists. */
async function probeSupported(page: Page): Promise<boolean> {
  await page.route("**/webgpu-probe-bundle.js", (r) =>
    r.fulfill({ path: bundlePath }),
  );
  await page.goto("/");
  await page.addScriptTag({ url: "/webgpu-probe-bundle.js" });
  return page.evaluate(() => {
    const w = window as unknown as {
      __webgpuProbe?: { isSupported: () => Promise<boolean> };
    };
    if (!w.__webgpuProbe) throw new Error("probe bundle did not install __webgpuProbe");
    return w.__webgpuProbe.isSupported();
  });
}

test("webgpu photo path: dims, flats, alpha, residual", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!(await probeSupported(page)), "no WebGPU adapter in this browser");
  const m = await page.evaluate(() => {
    const w = window as unknown as { __webgpuProbe: WebGPUProbe };
    return w.__webgpuProbe.runMatrix();
  });
  const photo = m["photoBW"];
  expect([photo.outW, photo.outH]).toEqual([16, 16]);
  expect(photo.residual).toBeLessThan(0.01);
  expect(photo.leftMean).toBeLessThan(0.03);
  expect(photo.rightMean).toBeGreaterThan(0.97);
  expect(photo.alphaOk).toBe(true);
  expect(photo.refMeanAbsDiff).toBeLessThan(0.08);

  const alpha = m["photoAlpha"];
  expect([alpha.outW, alpha.outH]).toEqual([16, 16]);
  expect(alpha.alphaOk).toBe(true);
  expect(alpha.residual).toBeLessThan(0.01);
});

test("webgpu presets run without error", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!(await probeSupported(page)), "no WebGPU adapter in this browser");
  const m = await page.evaluate(() => {
    const w = window as unknown as { __webgpuProbe: WebGPUProbe };
    return w.__webgpuProbe.runMatrix();
  });
  for (const key of ["smoothBW", "pixelBW"]) {
    expect([m[key].outW, m[key].outH]).toEqual([16, 16]);
    expect(m[key].residual).toBeLessThan(0.01);
    expect(m[key].alphaOk).toBe(true);
  }
});
