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
  expect(errors).toEqual([]);
});
