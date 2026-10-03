import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("shell renders tool, upscales 8x8 to 16x16", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vice" })).toBeVisible();
  await expect(page.getByText("Drop images")).toBeVisible();

  // 8x8 red PNG via canvas, uploaded through the sr-only file input.
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
    name: "red.png",
    mimeType: "image/png",
    buffer: Buffer.from(buf),
  });
  await page.getByRole("button", { name: "Upscale", exact: true }).click();
  await expect(page.getByText("done")).toBeVisible({ timeout: 60_000 });
  const dl = page.getByRole("link", { name: /Download PNG/ });
  await expect(dl).toBeVisible();
  // meta line shown => projection ran with Lanczos-3
  await expect(page.getByText(/Lanczos-3/)).toBeVisible({ timeout: 20_000 });
});

test("3x bilinear path works without model", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const buf = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    const x = c.getContext("2d")!;
    x.fillStyle = "#2040c0";
    x.fillRect(0, 0, 8, 8);
    const b: Blob = await new Promise((r) => c.toBlob((v) => r(v!), "image/png"));
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  await page.getByLabel(/Choose image/).setInputFiles({
    name: "blue.png",
    mimeType: "image/png",
    buffer: Buffer.from(buf),
  });
  await page.getByRole("button", { name: "3×", exact: true }).click();
  await page.getByRole("button", { name: "Upscale", exact: true }).click();
  await expect(page.getByText("done")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Lanczos-3/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Download PNG/ })).toHaveAttribute("download", "blue-vice3x.png");
  await page.getByRole("group", { name: "Zoom" }).getByRole("button", { name: "2×", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Zoom" }).getByRole("button", { name: "2×", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

async function makePng(page: Page, color: string): Promise<Buffer> {
  const buf = await page.evaluate(async (c: string) => {
    const cv = document.createElement("canvas");
    cv.width = 8;
    cv.height = 8;
    const x = cv.getContext("2d")!;
    x.fillStyle = c;
    x.fillRect(0, 0, 8, 8);
    const b: Blob = await new Promise((r) => cv.toBlob((v) => r(v!), "image/png"));
    return [...new Uint8Array(await b.arrayBuffer())];
  }, color);
  return Buffer.from(buf);
}

test("batch 3x produces zip", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.getByLabel(/Choose image/).setInputFiles([
    { name: "red.png", mimeType: "image/png", buffer: await makePng(page, "#c02020") },
    { name: "blue.png", mimeType: "image/png", buffer: await makePng(page, "#2040c0") },
  ]);
  await expect(page.getByRole("button", { name: "Upscale 2" })).toBeVisible();
  await page.getByRole("button", { name: "3×", exact: true }).click();
  await page.getByRole("button", { name: "Upscale 2", exact: true }).click();
  await expect(page.getByText("done")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("group", { name: "Results" })).toBeVisible();
  await page.getByRole("button", { name: "Download all (.zip)" }).click();
  const dl = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /vice-batch\.zip ready/ }).click(),
  ]);
  expect(dl[0].suggestedFilename()).toBe("vice-batch.zip");
  const zipPath = await dl[0].path();
  expect(zipPath).toBeTruthy();
  const magic = Buffer.from(await readFile(zipPath as string)).subarray(0, 2).toString();
  expect(magic).toBe("PK");
  await page.getByRole("button", { name: "Remove red.png" }).click();
  await expect(page.getByRole("button", { name: "Upscale", exact: true })).toBeVisible();
});
