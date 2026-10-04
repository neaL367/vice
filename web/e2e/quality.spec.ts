import { expect, test } from "@playwright/test";

// Fixture-based output quality: completion tests prove the pipe runs, these
// prove it computes the right pixels. Small fixtures keep runs fast; all
// reads happen in-page (blob URL -> ImageBitmap -> 2d canvas) so no PNG
// decoder dependency is needed in Node.

async function uploadCanvas(
  page: import("@playwright/test").Page,
  name: string,
  w: number,
  h: number,
  paint: string,
): Promise<void> {
  const buf = await page.evaluate(
    async ({ w, h, paint }: { w: number; h: number; paint: string }) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const x = c.getContext("2d")!;
      x.fillStyle = paint;
      if (paint === "halves-bw") {
        x.fillStyle = "#000000";
        x.fillRect(0, 0, w / 2, h);
        x.fillStyle = "#ffffff";
        x.fillRect(w / 2, 0, w - w / 2, h);
      } else if (paint === "halves-alpha") {
        x.clearRect(0, 0, w, h);
        x.fillStyle = "#c02020";
        x.fillRect(0, 0, w / 2, h);
      } else {
        x.fillRect(0, 0, w, h);
      }
      const b: Blob = await new Promise((r) => c.toBlob((v) => r(v!), "image/png"));
      return [...new Uint8Array(await b.arrayBuffer())];
    },
    { w, h, paint },
  );
  await page.getByLabel(/Choose image/).setInputFiles({
    name,
    mimeType: "image/png",
    buffer: Buffer.from(buf),
  });
}

async function readResultPixels(
  page: import("@playwright/test").Page,
): Promise<{ w: number; h: number; data: number[] }> {
  // The result panel renders a beat after the "done" progress flag.
  await expect(page.getByRole("link", { name: /Download/ }).first()).toBeVisible({
    timeout: 20_000,
  });
  return await page.evaluate(async (wantW: number) => {
    // CSP blocks fetch(blob:) here; read the rendered result <img> instead
    // (same-origin blob draw does not taint the canvas).
    const imgs = [...document.images];
    const img = imgs.find((im) => im.naturalWidth === wantW && im.complete);
    if (!img) {
      throw new Error(
        `no rendered result img (widths: ${imgs.map((im) => im.naturalWidth).join(",")})`,
      );
    }
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const ctx = cv.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height);
    return { w: cv.width, h: cv.height, data: [...d.data] };
  }, 16);
}

async function upscaleAndRead(
  page: import("@playwright/test").Page,
  name: string,
  paint: string,
): Promise<{ w: number; h: number; data: number[] }> {
  await page.goto("/");
  await uploadCanvas(page, name, 8, 8, paint);
  await page.getByRole("button", { name: "Upscale", exact: true }).click();
  await expect(page.getByText("done")).toBeVisible({ timeout: 60_000 });
  return readResultPixels(page);
}

test("flat mid-gray survives the linear-light round trip", async ({ page }) => {
  test.setTimeout(60_000);
  // #808080 -> linear ~0.216 -> box mean identical -> sRGB ~128.
  // 8-bit quantize + TPDF dither budget: every pixel within +-4.
  const { w, h, data } = await upscaleAndRead(page, "gray.png", "#808080");
  expect([w, h]).toEqual([16, 16]);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    expect(data[i]).toBeGreaterThanOrEqual(124);
    expect(data[i]).toBeLessThanOrEqual(132);
    expect(data[i + 1]).toBeGreaterThanOrEqual(124);
    expect(data[i + 1]).toBeLessThanOrEqual(132);
    expect(data[i + 2]).toBeGreaterThanOrEqual(124);
    expect(data[i + 2]).toBeLessThanOrEqual(132);
    expect(data[i + 3]).toBe(255);
    sum += data[i];
  }
  expect(sum / (data.length / 4)).toBeGreaterThanOrEqual(126);
  expect(sum / (data.length / 4)).toBeLessThanOrEqual(130);
});

test("black-white halves map to flat 0/255 regions", async ({ page }) => {
  test.setTimeout(60_000);
  const { w, h, data } = await upscaleAndRead(page, "halves.png", "halves-bw");
  expect([w, h]).toEqual([16, 16]);
  const colMean = (x0: number, x1: number): number => {
    let s = 0;
    let n = 0;
    for (let y = 0; y < h; y++)
      for (let x = x0; x < x1; x++) {
        s += data[(y * w + x) * 4];
        n++;
      }
    return s / n;
  };
  // Far from the step, flats must hold: dering clamp kills Lanczos ringing.
  expect(colMean(0, 4)).toBeLessThanOrEqual(6);
  expect(colMean(12, 16)).toBeGreaterThanOrEqual(249);
});

test("step edge stays crisp without overshoot", async ({ page }) => {
  test.setTimeout(60_000);
  const { w, h, data } = await upscaleAndRead(page, "edge.png", "halves-bw");
  expect([w, h]).toEqual([16, 16]);
  // No pixel may leave the [0,255] box by construction; the shock PDE must
  // keep the transition narrow: at most 4 of 16 columns in-between.
  let between = 0;
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) s += data[(y * w + x) * 4];
    const m = s / h;
    if (m > 10 && m < 245) between++;
  }
  expect(between).toBeLessThanOrEqual(4);
  // Monotone across the edge: no ringing bumps.
  let prev = -1;
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) s += data[(y * w + x) * 4];
    const m = s / h;
    expect(m).toBeGreaterThanOrEqual(prev - 8);
    prev = m;
  }
});

test("transparent half keeps exact alpha", async ({ page }) => {
  test.setTimeout(60_000);
  const { w, h, data } = await upscaleAndRead(page, "alphaq.png", "halves-alpha");
  expect([w, h]).toEqual([16, 16]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (x < 6) expect(a).toBe(255);
      if (x > 9) expect(a).toBe(0);
    }
  }
});
