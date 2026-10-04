import { expect, test, type Page } from "@playwright/test";

// Calibration-workspace coverage: state transitions, output-limit
// messaging, keyboard operability, sheets, and viewport overflow.

async function uploadRed(page: Page, name = "red.png"): Promise<void> {
  const buf = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    const x = c.getContext("2d")!;
    x.fillStyle = "#c02020";
    x.fillRect(0, 0, 8, 8);
    const b: Blob = await new Promise((r) => c.toBlob((v) => r(v!), "image/png"));
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  await page.getByLabel(/Choose image/).setInputFiles({
    name,
    mimeType: "image/png",
    buffer: Buffer.from(buf),
  });
}

test.describe("desktop workspace", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("empty shows dropzone copy, no rails, no overflow", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Drop images to upscale")).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose images" })).toBeVisible();
    await expect(page.getByRole("complementary")).toHaveCount(0);
    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - window.innerWidth,
      y: document.documentElement.scrollHeight - window.innerHeight,
    }));
    expect(overflow.x).toBeLessThanOrEqual(0);
    expect(overflow.y).toBeLessThanOrEqual(0);
  });

  test("staged shows queue, inspector limit line, and evidence rail", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await uploadRed(page);
    // Queue rail with the staged file.
    await expect(page.getByRole("complementary", { name: "File queue" })).toBeVisible();
    await expect(page.getByText("red.png")).toBeVisible();
    // Inspector limit messaging before the run (8x8 at 2x = 256 px).
    await expect(page.getByText("2× output: 0.0 MP · memory-bounded streaming.")).toBeVisible();
    // Evidence rail staged line.
    await expect(page.getByText("Original 8×8 → 2× → 16×16 · 0.0 MP (max 64 MP in-browser)")).toBeVisible();
  });

  test("keyboard runs upscale and downloads result", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await uploadRed(page);
    // Tab to the inspector Upscale button and activate with Enter.
    await page.getByRole("button", { name: "Upscale", exact: true }).last().focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("done")).toBeVisible({ timeout: 60_000 });
    // Evidence rail carries the measured facts.
    await expect(page.getByText(/residual 2\.1e-8|residual \d/).first()).toBeVisible();
    // Keyboard-activate the header download link.
    const dl = page.getByRole("link", { name: /Download PNG/ });
    await dl.focus();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.keyboard.press("Enter"),
    ]);
    expect(download.suggestedFilename()).toMatch(/red-vice2x\.png/);
  });
});

test.describe("mobile workspace", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("bottom bar, sheets, canvas share, no overflow", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    // Rails are desktop-only; bottom bar carries the primary actions.
    await expect(page.getByRole("complementary")).toHaveCount(0);
    await uploadRed(page);
    await expect(
      page.getByRole("button", { name: "Upscale", exact: true }).last(),
    ).toBeVisible();

    // Queue sheet opens and closes.
    await page.getByRole("button", { name: /Open file queue/ }).first().click();
    await expect(page.getByRole("dialog", { name: "File queue" })).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "File queue" }).getByText("red.png"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close file queue" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Inspector sheet opens and closes.
    await page.getByRole("button", { name: "Open settings" }).first().click();
    await expect(page.getByRole("dialog", { name: "Output settings" })).toBeVisible();
    await page.getByRole("button", { name: "Close settings" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Canvas keeps the majority of the height; no page scroll.
    const share = await page.evaluate(() => {
      const stage = document.querySelector('[data-testid="workspace-stage"]');
      return stage ? stage.clientHeight / window.innerHeight : 0;
    });
    expect(share).toBeGreaterThanOrEqual(0.55);
    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - window.innerWidth,
      y: document.documentElement.scrollHeight - window.innerHeight,
    }));
    expect(overflow.x).toBeLessThanOrEqual(0);
    expect(overflow.y).toBeLessThanOrEqual(0);
  });
});
