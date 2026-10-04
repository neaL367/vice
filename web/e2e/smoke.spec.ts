import { expect, test, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { readFile } from "node:fs/promises";

// --- Forged-metadata helpers (Node side) ----------------------------------
// Canvas output carries no ICC/EXIF, so the tests below splice real chunks
// into real encoder bytes: PNG iCCP before IDAT, JPEG APP1 Exif after SOI.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  td.copy(out, 4);
  out.writeUInt32BE(crc32(td), 8 + data.length);
  return out;
}

/** Insert an iCCP chunk (deflated fake profile) before the first IDAT. */
function insertIccpIntoPng(png: Buffer, profile: Buffer): Buffer {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  const payload = Buffer.concat([
    Buffer.from("vice\0", "ascii"),
    Buffer.from([0]),
    deflateSync(profile),
  ]);
  const iccp = pngChunk("iCCP", payload);
  let off = 8;
  while (off + 8 <= png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString("ascii");
    if (type === "IDAT") {
      return Buffer.concat([png.subarray(0, off), iccp, png.subarray(off)]);
    }
    if (type === "IEND") throw new Error("PNG has no IDAT");
    off += 12 + len;
  }
  throw new Error("truncated PNG");
}

/** Insert APP1 Exif with orientation=6 (rotate 90 CW) right after SOI. */
function insertExifOrientation6(jpeg: Buffer): Buffer {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("not a JPEG");
  const tiff = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // II*\0, IFD at 8
    0x01, 0x00, // 1 entry
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, // tag 0x0112 SHORT×1
    0x06, 0x00, 0x00, 0x00, // value 6
    0x00, 0x00, 0x00, 0x00, // next IFD none
  ]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const seg = Buffer.alloc(2 + 2 + payload.length);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  seg.writeUInt16BE(payload.length + 2, 2);
  payload.copy(seg, 4);
  return Buffer.concat([jpeg.subarray(0, 2), seg, jpeg.subarray(2)]);
}

function pngDimensions(png: Buffer): { w: number; h: number } {
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}

function bufferHasTag(buf: Buffer, tag: string): boolean {
  const t = Buffer.from(tag, "ascii");
  return buf.indexOf(t) !== -1;
}

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

test("alpha transparency path completes with download", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  // Left half opaque red, right half fully transparent: exercises the
  // premultiplied-alpha branch (un-premultiply + linear alpha preserve).
  const buf = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    const x = c.getContext("2d")!;
    x.clearRect(0, 0, 8, 8);
    x.fillStyle = "#c02020";
    x.fillRect(0, 0, 4, 8);
    const b: Blob = await new Promise((r) => c.toBlob((v) => r(v!), "image/png"));
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  await page.getByLabel(/Choose image/).setInputFiles({
    name: "alpha.png",
    mimeType: "image/png",
    buffer: Buffer.from(buf),
  });
  await page.getByRole("button", { name: "Upscale", exact: true }).click();
  await expect(page.getByText("done")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Lanczos-3/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Download PNG/ })).toHaveAttribute(
    "download",
    "alpha-vice2x.png",
  );
});

test("chained 4x (2x twice) completes with download", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const buf = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    const x = c.getContext("2d")!;
    x.fillStyle = "#20a060";
    x.fillRect(0, 0, 8, 8);
    const b: Blob = await new Promise((r) => c.toBlob((v) => r(v!), "image/png"));
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  await page.getByLabel(/Choose image/).setInputFiles({
    name: "green.png",
    mimeType: "image/png",
    buffer: Buffer.from(buf),
  });
  await page.getByRole("button", { name: "4×", exact: true }).click();
  await page.getByRole("button", { name: "2××2×", exact: true }).click();
  await page.getByRole("button", { name: "Upscale", exact: true }).click();
  await expect(page.getByText("done")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Lanczos-3/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Download PNG/ })).toHaveAttribute(
    "download",
    "green-vice4x.png",
  );
});

test("ICC profile round-trips from iCCP PNG into output PNG", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
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
  // Splice a forged iCCP chunk into real encoder bytes. Content is fake but
  // the container path (extract file bytes -> embed on encode) is real.
  const fakeProfile = Buffer.from("vice-fake-icc-profile-bytes-0123456789");
  const withIcc = insertIccpIntoPng(Buffer.from(raw), fakeProfile);
  await page.getByLabel(/Choose image/).setInputFiles({
    name: "icc.png",
    mimeType: "image/png",
    buffer: withIcc,
  });
  await page.getByRole("button", { name: "Upscale", exact: true }).click();
  await expect(page.getByText("done")).toBeVisible({ timeout: 60_000 });
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /Download PNG/ }).click(),
  ]);
  const outPath = await dl.path();
  expect(outPath).toBeTruthy();
  const out = await readFile(outPath as string);
  expect(bufferHasTag(out, "iCCP")).toBe(true);
});

test("EXIF orientation 6 rotates portrait JPEG before upscale", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  // 8x4 landscape JPEG tagged orientation 6: from-image must present it as
  // 4x8 portrait, so a 2x upscale yields an 8x16 PNG.
  const raw = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 4;
    const x = c.getContext("2d")!;
    x.fillStyle = "#2060c0";
    x.fillRect(0, 0, 8, 4);
    const b: Blob = await new Promise((r) => c.toBlob((v) => r(v!), "image/jpeg", 0.9));
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  const oriented = insertExifOrientation6(Buffer.from(raw));
  await page.getByLabel(/Choose image/).setInputFiles({
    name: "exif.jpg",
    mimeType: "image/jpeg",
    buffer: oriented,
  });
  await page.getByRole("button", { name: "Upscale", exact: true }).click();
  await expect(page.getByText("done")).toBeVisible({ timeout: 60_000 });
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /Download PNG/ }).click(),
  ]);
  const outPath = await dl.path();
  expect(outPath).toBeTruthy();
  const dims = pngDimensions(await readFile(outPath as string));
  expect(dims).toEqual({ w: 8, h: 16 });
});

test("3x Lanczos-3 path works without model", async ({ page }) => {
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
