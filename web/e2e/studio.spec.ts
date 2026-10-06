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
