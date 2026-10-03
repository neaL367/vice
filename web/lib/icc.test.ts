import { describe, expect, test } from "bun:test";
import { extractIccProfile } from "./icc";

describe("icc extraction", () => {
  test("returns null on tiny or non-image buffer", async () => {
    expect(await extractIccProfile(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(await extractIccProfile(new Uint8Array(20))).toBeNull();
  });

  test("extracts ICC profile from JPEG APP2 marker", async () => {
    const iccPayload = new Uint8Array([0x00, 0x01, 0x02, 0x77, 0x88]);
    const marker = [
      0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00,
    ];
    const segLen = 2 + 12 + 2 + iccPayload.length;
    const jpeg = new Uint8Array(2 + 2 + 2 + 12 + 2 + iccPayload.length + 2);
    // SOI
    jpeg[0] = 0xff;
    jpeg[1] = 0xd8;
    // APP2
    jpeg[2] = 0xff;
    jpeg[3] = 0xe2;
    jpeg[4] = (segLen >> 8) & 0xff;
    jpeg[5] = segLen & 0xff;
    jpeg.set(marker, 6);
    jpeg[18] = 1; // seq
    jpeg[19] = 1; // total
    jpeg.set(iccPayload, 20);
    // EOI
    jpeg[jpeg.length - 2] = 0xff;
    jpeg[jpeg.length - 1] = 0xd9;

    const extracted = await extractIccProfile(jpeg);
    expect(extracted).not.toBeNull();
    expect(extracted?.length).toBe(iccPayload.length);
    expect(extracted?.[3]).toBe(0x77);
  });

  test("extracts ICC profile from WebP ICCP chunk", async () => {
    const iccPayload = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
    const webp = new Uint8Array(12 + 8 + iccPayload.length);
    // RIFF header
    webp.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    webp.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    // ICCP chunk
    webp.set([0x49, 0x43, 0x43, 0x50], 12); // ICCP
    const len = iccPayload.length;
    webp[16] = len & 0xff;
    webp[17] = (len >> 8) & 0xff;
    webp[18] = (len >> 16) & 0xff;
    webp[19] = (len >> 24) & 0xff;
    webp.set(iccPayload, 20);

    const extracted = await extractIccProfile(webp);
    expect(extracted).not.toBeNull();
    expect(extracted?.length).toBe(4);
    expect(extracted?.[1]).toBe(0x34);
  });
});
