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

  // Output canvas exists at 2x dims with non-blank pixels. The done commit
  // is a transition: poll for the painted canvas instead of assuming it lands
  // in the same frame as the Ready text.
  const out = await (async () => {
    for (let i = 0; i < 50; i++) {
      const o = await page.evaluate(() => {
        const cs = [...document.querySelectorAll("canvas")];
        const c = cs[cs.length - 1] as HTMLCanvasElement;
        if (c.width !== 1536) return null;
        const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        let mn = 255;
        let mx = 0;
        for (let j = 0; j < d.length; j += 401) {
          if (d[j] < mn) mn = d[j];
          if (d[j] > mx) mx = d[j];
        }
        return { w: c.width, h: c.height, spread: mx - mn };
      });
      if (o) return o;
      await page.waitForTimeout(200);
    }
    throw new Error("output canvas never painted at 2x");
  })();
  expect(out.w).toBe(1536);
  expect(out.h).toBe(1024);
  expect(out.spread).toBeGreaterThan(50);
  // Dock never covers the image: stage bottom is at/above dock top.
  const layout = await page.evaluate(() => {
    const stage = document.querySelector('[role="slider"]')!.getBoundingClientRect();
    const dock = document.querySelector('[aria-label="Scale"]')!.getBoundingClientRect();
    return { stageBottom: stage.bottom, dockTop: dock.top };
  });
  expect(layout.stageBottom).toBeLessThanOrEqual(layout.dockTop + 1);
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

test("portrait image fits, layers register, divider moves freely", async ({ page }) => {  const errors: string[] = [];
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
test("divider grip drags while zoomed; pan stays clamped", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  const photo = path.resolve(__dirname, "../../tools/eval/data/photos/kodim23.png");
  await page.locator('input[type="file"]').first().setInputFiles(photo);
  await page.getByRole("button", { name: "Upscale" }).click();
  await expect(page.getByText("Ready", { exact: false })).toBeVisible({ timeout: 90000 });

  const slider = page.getByLabel("Reveal comparison");
  // Zoom in hard, then drag the divider grip: split must still follow.
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -900);
  await expect
    .poll(async () => {
      const c = await page.evaluate(() => {
        const el = document.querySelectorAll("canvas")[0] as HTMLCanvasElement;
        return el.getBoundingClientRect().width;
      });
      return c;
    }, { timeout: 5000 })
    .toBeGreaterThan(1200);
  const grip = page.locator('[aria-hidden="true"] > div:has-text("⟷")').first();
  const box = await grip.boundingBox();
  if (!box) throw new Error("grip not found");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 200, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const v = Number(await slider.getAttribute("aria-valuenow"));
  expect(v).toBeLessThan(50);

  // Huge pan fling: image must remain partially visible (clamped).
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(2400, 1400, { steps: 8 });
  await page.mouse.up();
  const vis = await page.evaluate(() => {
    const stage = document.querySelector('[role="slider"]')!.getBoundingClientRect();
    const c = document.querySelectorAll("canvas")[0] as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const ix = Math.max(0, Math.min(stage.right, r.right) - Math.max(stage.left, r.left));
    const iy = Math.max(0, Math.min(stage.bottom, r.bottom) - Math.max(stage.top, r.top));
    return { ix, iy };
  });
  expect(vis.ix).toBeGreaterThan(50);
  expect(vis.iy).toBeGreaterThan(50);
  expect(errors).toEqual([]);
});
test("zoom out returns to center; download is full-res output", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  const photo = path.resolve(__dirname, "../../tools/eval/data/photos/kodim23.png");
  await page.locator('input[type="file"]').first().setInputFiles(photo);
  await page.getByRole("button", { name: "Upscale" }).click();
  await expect(page.getByText("Ready", { exact: false })).toBeVisible({ timeout: 90000 });

  // Zoom in (drifts pan via cursor anchor), then zoom back out with buttons:
  // the image must return to its fitted center.
  const center = () =>
    page.evaluate(() => {
      const stage = document.querySelector('[role="slider"]')!.getBoundingClientRect();
      const c = document.querySelectorAll("canvas")[0] as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      return { dx: r.left + r.width / 2 - (stage.left + stage.width / 2), w: r.width };
    });
  const c0 = await center();
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, -600);
  await expect.poll(async () => (await center()).w, { timeout: 5000 }).toBeGreaterThan(c0.w + 5);
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Zoom out" }).click();
  await expect.poll(async () => (await center()).w, { timeout: 5000 }).toBeLessThan(c0.w + 2);
  const c1 = await center();
  expect(Math.abs(c1.dx)).toBeLessThan(3);

  // Download delivers full-resolution bytes under the right name.
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download result" }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toMatch(/kodim23-2x\.png$/);
  const filePath = await download.path();
  const { size } = await import("node:fs").then((fs) => fs.promises.stat(filePath as string));
  // 1536x1024 photographic PNG is hundreds of KB, never a thumbnail.
  expect(size).toBeGreaterThan(200000);
  expect(errors).toEqual([]);
});
test("click opens the native picker and the image displays", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  const photo = path.resolve(__dirname, "../../tools/eval/data/photos/kodim23.png");
  // Real click path (not setInputFiles): the OS dialog must open.
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 10000 }),
    page.getByRole("button", { name: "Drop an image or choose a file" }).click(),
  ]);
  await chooser.setFiles(photo);
  // Uploaded image becomes visible at real size.
  await expect
    .poll(async () => {
      const w = await page.evaluate(() => {
        const c = document.querySelectorAll("canvas")[0] as HTMLCanvasElement | undefined;
        return c ? c.getBoundingClientRect().width : 0;
      });
      return w;
    }, { timeout: 15000 })
    .toBeGreaterThan(100);
  expect(errors).toEqual([]);
});
test("divider spans the image height; Center recovers it at heavy zoom", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  const photo = path.resolve(__dirname, "../../tools/eval/data/photos/kodim23.png");
  await page.locator('input[type="file"]').first().setInputFiles(photo);
  await page.getByRole("button", { name: "Upscale" }).click();
  await expect(page.getByText("Ready", { exact: false })).toBeVisible({ timeout: 90000 });

  // Divider line covers the full image rect, not the viewport.
  const geom = await page.evaluate(() => {
    const line = document.querySelector('[data-testid="divider-line"]')!.getBoundingClientRect();
    const c = document.querySelectorAll("canvas")[0] as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    return { line, img: { top: r.top, height: r.height } };
  });
  expect(Math.abs(geom.line.top - geom.img.top)).toBeLessThan(3);
  expect(Math.abs(geom.line.height - geom.img.height)).toBeLessThan(3);

  // Lose the divider: heavy zoom + fling, then keyboard away from center.
  const slider = page.getByLabel("Reveal comparison");
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -1200);
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(2400, 1400, { steps: 8 });
  await page.mouse.up();
  await slider.focus();
  for (let i = 0; i < 10; i++) await slider.press("ArrowRight");
  // One tap on Center: divider lands mid-viewport at the current pan/zoom
  // (view never jumps), instead of resetting to the image center.
  const beforeBox = await page.evaluate(() => {
    const c = document.querySelectorAll("canvas")[0] as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  await page.getByRole("button", { name: "Center comparison divider" }).click();
  const vis = await page.evaluate(() => {
    const stage = document.querySelector('[role="slider"]')!.getBoundingClientRect();
    const line = document.querySelector('[data-testid="divider-line"]')!.getBoundingClientRect();
    const c = document.querySelectorAll("canvas")[0] as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    return {
      mid: (line.left - stage.left) / stage.width,
      span: line.height,
      img: { x: r.x, y: r.y },
    };
  });
  expect(vis.mid).toBeGreaterThan(0.4);
  expect(vis.mid).toBeLessThan(0.6);
  // Image did not move: only the divider did.
  expect(Math.abs(vis.img.x - beforeBox.x)).toBeLessThan(2);
  expect(Math.abs(vis.img.y - beforeBox.y)).toBeLessThan(2);
  expect(vis.span).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

// 8× ships through the progressive WASM export: tiny BMP in, 512² out.
test("8x upscale works on small inputs", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await expect(page.getByText("Upscale your image")).toBeVisible();

  // 64×64 24-bit BMP step (left black, right white), built inline.
  const W = 64;
  const H = 64;
  const row = W * 3;
  const px = Buffer.alloc(row * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = x < W / 2 ? 0 : 255;
      // BMP is bottom-up BGR.
      const o = (H - 1 - y) * row + x * 3;
      px[o] = v;
      px[o + 1] = v;
      px[o + 2] = v;
    }
  const head = Buffer.alloc(54);
  head.write("BM", 0);
  head.writeUInt32LE(54 + px.length, 2);
  head.writeUInt32LE(54, 10);
  head.writeUInt32LE(40, 14);
  head.writeInt32LE(W, 18);
  head.writeInt32LE(H, 22);
  head.writeUInt16LE(1, 26);
  head.writeUInt16LE(24, 28);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "tiny.bmp",
    mimeType: "image/bmp",
    buffer: Buffer.concat([head, px]),
  });

  await page.getByRole("button", { name: "8×", exact: true }).click();
  await page.getByRole("button", { name: "Upscale" }).click();
  await expect(page.getByText("Ready", { exact: false })).toBeVisible({ timeout: 120000 });
  const dims = await page.evaluate(() => {
    const cs = [...document.querySelectorAll("canvas")];
    const c = cs[cs.length - 1] as HTMLCanvasElement;
    return { w: c.width, h: c.height };
  });
  expect(dims).toEqual({ w: 512, h: 512 });
  expect(errors).toEqual([]);
});

// Oversized inputs cannot select 8×: the button disables with guidance.
test("8x disables on large inputs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Upscale your image")).toBeVisible();
  const photo = path.resolve(__dirname, "../../tools/eval/data/photos/kodim23.png");
  await page.locator('input[type="file"]').first().setInputFiles(photo);
  const eight = page.getByRole("button", { name: "8×", exact: true });
  await expect(eight).toBeDisabled();
  await expect(eight).toHaveAttribute("title", /512px/);
});

// Offline: after first load the service worker serves shell + WASM from
// cache, so a full upload→upscale works with the network cut.
test("works offline after first load", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await expect(page.getByText("Upscale your image")).toBeVisible();
  // Wait for the service worker to take control before cutting the network.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByText("Upscale your image")).toBeVisible({ timeout: 15000 });
    const photo = path.resolve(__dirname, "../../tools/eval/data/photos/kodim23.png");
    await page.locator('input[type="file"]').first().setInputFiles(photo);
    await page.getByRole("button", { name: "Upscale" }).click();
    await expect(page.getByText("Ready", { exact: false })).toBeVisible({ timeout: 90000 });
  } finally {
    await context.setOffline(false);
  }
  expect(errors).toEqual([]);
});

// Coachmark: first result invites the drag, then gets out of the way.
test("divider hint shows until first drag", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await expect(page.getByText("Upscale your image")).toBeVisible();
  const photo = path.resolve(__dirname, "../../tools/eval/data/photos/kodim23.png");
  await page.locator('input[type="file"]').first().setInputFiles(photo);
  await page.getByRole("button", { name: "Upscale" }).click();
  await expect(page.getByText("Ready", { exact: false })).toBeVisible({ timeout: 90000 });

  const hint = page.getByText("Drag to compare", { exact: true });
  await expect(hint).toBeVisible();
  const grip = page.locator('[aria-hidden="true"] > div:has-text("⟷")').first();
  const box = await grip.boundingBox();
  if (!box) throw new Error("grip not found");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(hint).toBeHidden();
  expect(errors).toEqual([]);
});
