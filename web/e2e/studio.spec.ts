import { expect, test } from "@playwright/test";
import path from "node:path";

// Full pipeline: upload → input visible → upscale → result visible.
test("studio shows input and produces output", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/");
  await expect(page.getByText("Upscale your image")).toBeVisible();

  const photo = path.resolve(__dirname, "../../tools/eval/data/photos/kodim23.png");
  await page.locator('input[type="file"]').first().setInputFiles(photo);

  // Input canvas must carry real (non-blank) pixels.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const c = document.querySelectorAll("canvas")[0] as HTMLCanvasElement | undefined;
          if (!c || c.width === 0) return 0;
          const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
          let mn = 255;
          let mx = 0;
          for (let i = 0; i < d.length; i += 401) {
            if (d[i] < mn) mn = d[i];
            if (d[i] > mx) mx = d[i];
          }
          return mx - mn;
        }),
      { timeout: 15000 },
    )
    .toBeGreaterThan(50);

  await page.getByRole("button", { name: "Upscale" }).click();
  await expect(page.getByText("Ready", { exact: false })).toBeVisible({ timeout: 90000 });

  // Output canvas exists at 2x dims with non-blank pixels.
  const out = await page.evaluate(() => {
    const cs = [...document.querySelectorAll("canvas")];
    const c = cs[cs.length - 1] as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let mn = 255;
    let mx = 0;
    for (let i = 0; i < d.length; i += 401) {
      if (d[i] < mn) mn = d[i];
      if (d[i] > mx) mx = d[i];
    }
    return { w: c.width, h: c.height, spread: mx - mn };
  });
  expect(out.w).toBe(1536);
  expect(out.h).toBe(1024);
  expect(out.spread).toBeGreaterThan(50);
  // Comparison layers must align: identical display sizes.
  const aligned = await page.evaluate(() => {
    const cs = [...document.querySelectorAll("canvas")];
    const r = cs.map((c) => c.getBoundingClientRect());
    return { w0: r[0].width, w1: r[1].width, h0: r[0].height, h1: r[1].height };
  });
  expect(Math.abs(aligned.w0 - aligned.w1)).toBeLessThan(2);
  expect(Math.abs(aligned.h0 - aligned.h1)).toBeLessThan(2);
  // Layers must be visibly sized (regression: 1px canvases from unmeasured box).
  expect(aligned.w0).toBeGreaterThan(100);
  expect(aligned.h0).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

// Every visible control responds: scale switch, zoom in/out/fit, reveal slider.
test("controls all work without overlap errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  const photo = path.resolve(__dirname, "../../tools/eval/data/photos/kodim23.png");
  await page.locator('input[type="file"]').first().setInputFiles(photo);
  await page.getByRole("button", { name: "4×", exact: true }).click();
  await expect(page.getByText("3072×2048")).toBeVisible();
  await page.getByRole("button", { name: "Upscale" }).click();
  await expect(page.getByText("Ready", { exact: false })).toBeVisible({ timeout: 90000 });

  // Reveal control moves the split via keyboard (stage is the slider).
  const slider = page.getByLabel("Reveal comparison");
  await slider.focus();
  await slider.press("ArrowLeft");
  const left = await slider.getAttribute("aria-valuenow");
  expect(Number(left)).toBeLessThan(50);

  // Wheel zooms the layer; drag on the image moves the split.
  const size = () =>
    page.evaluate(() => {
      const c = document.querySelectorAll("canvas")[0] as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
  const before = await size();
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, -400);
  // Poll: wheel dispatch resolves before React flushes the re-render.
  await expect
    .poll(async () => (await size()).w, { timeout: 5000 })
    .toBeGreaterThan(before.w + 5);
  await page.getByRole("button", { name: "Fit to view" }).click();
  const fit = await size();
  expect(Math.abs(fit.w - before.w)).toBeLessThan(2);

  // Drag reveals: press left-of-center and drag right, split follows.
  await page.mouse.move(200, 400);
  await page.mouse.down();
  await page.mouse.move(700, 400, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await slider.getAttribute("aria-valuenow")), { timeout: 5000 })
    .toBeGreaterThan(50);
  expect(errors).toEqual([]);
});

test.describe("mobile touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("upload and upscale on a small touch screen", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/");
    const photo = path.resolve(__dirname, "../../tools/eval/data/photos/kodim23.png");
    await page.locator('input[type="file"]').first().setInputFiles(photo);
    await page.getByRole("button", { name: "Upscale" }).tap();
    await expect(page.getByText("Ready", { exact: false })).toBeVisible({ timeout: 90000 });
    expect(errors).toEqual([]);
  });
});

test("invalid file shows a human error, not a crash", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByText("isn't an image")).toBeVisible();
  expect(errors).toEqual([]);
});

test("portrait image fits, layers register, divider moves freely", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  // kodim04.png is 512x768 portrait.
  const photo = path.resolve(__dirname, "../../tools/eval/data/photos/kodim04.png");
  await page.locator('input[type="file"]').first().setInputFiles(photo);
  await page.getByRole("button", { name: "Upscale" }).click();
  await expect(page.getByText("Ready", { exact: false })).toBeVisible({ timeout: 90000 });

  const rects = () =>
    page.evaluate(() => {
      const cs = [...document.querySelectorAll("canvas")];
      const stage = document.querySelector('[role="slider"]')!.getBoundingClientRect();
      const r = cs.map((c) => c.getBoundingClientRect());
      return {
        stage: { w: stage.width, h: stage.height },
        in: { x: r[0].x, y: r[0].y, w: r[0].width, h: r[0].height },
        out: { x: r[1].x, y: r[1].y, w: r[1].width, h: r[1].height },
      };
    });
  const a = await rects();
  // Fit inside the stage.
  expect(a.in.w).toBeLessThanOrEqual(a.stage.w + 1);
  expect(a.in.h).toBeLessThanOrEqual(a.stage.h + 1);
  expect(a.in.w).toBeGreaterThan(50);
  // Layers share one rect.
  for (const k of ["x", "y", "w", "h"] as const) {
    expect(Math.abs(a.in[k] - a.out[k])).toBeLessThan(2);
  }

  // Divider left→right→left: clip changes, image rects never move.
  const slider = page.getByLabel("Reveal comparison");
  const at = () => slider.getAttribute("aria-valuenow").then(Number);
  await slider.focus();
  for (let i = 0; i < 12; i++) await slider.press("ArrowRight");
  expect(await at()).toBeGreaterThan(80);
  const b = await rects();
  for (let i = 0; i < 22; i++) await slider.press("ArrowLeft");
  expect(await at()).toBeLessThan(20);
  const c = await rects();
  for (const r of [b, c]) {
    for (const k of ["x", "y", "w", "h"] as const) {
      expect(Math.abs(r.in[k] - a.in[k])).toBeLessThan(2);
      expect(Math.abs(r.in[k] - r.out[k])).toBeLessThan(2);
    }
  }
  expect(errors).toEqual([]);
});
