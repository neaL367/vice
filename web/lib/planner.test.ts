import { describe, expect, test } from "bun:test";
import { probeImage, ProbeError } from "../features/vice/planner/probe";
import { planRender, PlanError } from "../features/vice/planner/plan";
import type { DeviceFacts, JobRequest } from "../features/vice/planner/plan";
import { sanitizeStem, uniqueFileHandle, uniqueName } from "../features/vice/planner/names";
import { OpfsSink, opfsSupported } from "../features/vice/export/opfs-sink";

function pngBytes(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([137, 80, 78, 71, 13, 10, 26, 10]);
  b[11] = 13;
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  b[16] = (w >>> 24) & 255;
  b[17] = (w >>> 16) & 255;
  b[18] = (w >>> 8) & 255;
  b[19] = w & 255;
  b[20] = (h >>> 24) & 255;
  b[21] = (h >>> 16) & 255;
  b[22] = (h >>> 8) & 255;
  b[23] = h & 255;
  b[24] = 8;
  b[25] = 2;
  return b;
}

function jpegBytes(w: number, h: number): Uint8Array {
  // SOI + SOF0 (baseline): FF D8, FF C0 len=8+2? SOF len covers precision +
  // dims: [FF C0 00 0B 08 HH HH WW WW CC].
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    (h >>> 8) & 255, h & 255, (w >>> 8) & 255, w & 255, 0x03,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
  ]);
}

function webpLosslessBytes(w: number, h: number): Uint8Array {
  // RIFF + WEBP + VP8L + 0x2f + packed 14-bit dims.
  const b = new Uint8Array(30);
  const tag = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) b[o + i] = s.charCodeAt(i);
  };
  tag(0, "RIFF");
  tag(8, "WEBP");
  tag(12, "VP8L");
  b[20] = 0x2f;
  const bits = ((h - 1) << 14) | (w - 1);
  b[21] = bits & 255;
  b[22] = (bits >>> 8) & 255;
  b[23] = (bits >>> 16) & 255;
  b[24] = (bits >>> 24) & 255;
  return b;
}

describe("probeImage", () => {
  test("sniffs PNG dimensions from IHDR", () => {
    const p = probeImage(pngBytes(800, 600));
    expect(p.format).toBe("png");
    expect(p.w).toBe(800);
    expect(p.h).toBe(600);
    expect(p.bytes).toBe(33);
  });

  test("sniffs JPEG SOF0 dimensions", () => {
    const p = probeImage(jpegBytes(640, 480));
    expect(p.format).toBe("jpeg");
    expect(p.w).toBe(640);
    expect(p.h).toBe(480);
  });

  test("sniffs WebP lossless dimensions", () => {
    const p = probeImage(webpLosslessBytes(100, 200));
    expect(p.format).toBe("webp");
    expect(p.w).toBe(100);
    expect(p.h).toBe(200);
  });

  test.each([[new Uint8Array(4)], [new Uint8Array(64).fill(0xff)], [pngBytes(0, 10)]] as const)(
    "rejects garbage/truncated/impossible headers",
    (bytes) => {
      expect(() => probeImage(bytes as Uint8Array)).toThrow(ProbeError);
    },
  );

  test("rejects dimensions beyond the core cap", () => {
    expect(() => probeImage(pngBytes(200000, 10))).toThrow(/exceed core cap/);
  });
});

describe("uniqueName", () => {
  test("first free name wins, then (1), (2)", () => {
    const taken = new Set(["a.png"]);
    expect(uniqueName("a", "png", (n) => taken.has(n))).toBe("a (1).png");
    taken.add("a (1).png");
    expect(uniqueName("a", "png", (n) => taken.has(n))).toBe("a (2).png");
  });

  test("strips illegal filesystem characters", () => {
    expect(sanitizeStem('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(uniqueName("", "png", () => false)).toBe("image.png");
  });

  test("uniqueFileHandle skips taken names without overwriting", async () => {
    const taken = new Set(["a.png", "a (1).png"]);
    const created: string[] = [];
    const dir = {
      getFileHandle: async (name: string, opts: { create: boolean }) => {
        if (!opts.create && !taken.has(name)) throw new Error("not found");
        if (opts.create) {
          if (taken.has(name)) throw new Error("exists");
          taken.add(name);
          created.push(name);
          return { handle: name };
        }
        return { handle: name };
      },
    };
    const r = await uniqueFileHandle(dir, "a", "png");
    expect(r.fileName).toBe("a (2).png");
    expect(created).toEqual(["a (2).png"]);
  });
});

describe("opfs-sink", () => {
  test("reports unsupported without navigator.storage and fails loudly", async () => {
    expect(opfsSupported()).toBe(false);
    await expect(OpfsSink.create("x.png")).rejects.toThrow(/OPFS is not supported/);
    await expect(OpfsSink.remove("x.png")).resolves.toBeUndefined();
  });
});

const RICH: DeviceFacts = {
  logicalCores: 8,
  deviceMemoryGB: 16,
  opfs: true,
  fileSystemAccess: true,
  storageFreeBytes: 100 * 2 ** 30,
};
const LEAN: DeviceFacts = {
  logicalCores: 2,
  deviceMemoryGB: 2,
  opfs: false,
  fileSystemAccess: false,
  storageFreeBytes: 1 * 2 ** 30,
};
const EST = 100 << 20; // stub estimator: 100 MB
const estimate = () => EST;
const blobCapAt = (mp: number) => (outMP: number) => outMP > mp;

describe("planRender", () => {
  test("small blob job plans workers + blob + reasons", () => {
    const job: JobRequest = { scale: 2, chained4x: false, fileCount: 1, preferSave: "blob" };
    const plan = planRender({ format: "png", w: 100, h: 100, bytes: 1000 }, job, RICH, estimate, blobCapAt(64));
    expect(plan.sink.kind).toBe("blob");
    expect(plan.workers).toBe(8);
    expect(plan.policy).toBe("direct");
    expect(plan.geometry.outW).toBe(200);
    expect(plan.budget.estimatedPeakBytes).toBe(EST);
    expect(plan.reasons.length).toBeGreaterThan(0);
  });

  test("4x chained selects clean policy", () => {
    const job: JobRequest = { scale: 4, chained4x: true, fileCount: 1, preferSave: "blob" };
    const plan = planRender({ format: "png", w: 100, h: 100, bytes: 1000 }, job, RICH, estimate, blobCapAt(64));
    expect(plan.policy).toBe("clean");
  });

  test("folder request routes uncapped without consulting Blob cap", () => {
    const job: JobRequest = { scale: 4, chained4x: true, fileCount: 3, preferSave: "blob" };
    let capChecked = false;
    const plan = planRender(
      { format: "png", w: 1000, h: 1000, bytes: 1000 },
      job,
      RICH,
      estimate,
      () => {
        capChecked = true;
        return true;
      },
    );
    expect(plan.sink.kind).toBe("folder");
    expect(capChecked).toBe(false);
  });

  test("over-cap blob without OPFS plans strips, never dead-ends", () => {
    const job: JobRequest = { scale: 4, chained4x: false, fileCount: 1, preferSave: "blob" };
    const plan = planRender(
      { format: "png", w: 10000, h: 10000, bytes: 1000 },
      job,
      LEAN,
      estimate,
      () => true,
    );
    expect(plan.sink.kind).toBe("strips");
  });

  test("over-cap blob with OPFS plans opfs temp", () => {
    const job: JobRequest = { scale: 4, chained4x: false, fileCount: 1, preferSave: "blob" };
    const plan = planRender(
      { format: "png", w: 10000, h: 10000, bytes: 1000 },
      job,
      { ...LEAN, opfs: true },
      estimate,
      () => true,
    );
    expect(plan.sink.kind).toBe("opfs");
  });

  test("folder without File System Access errors with action", () => {
    const job: JobRequest = { scale: 2, chained4x: false, fileCount: 2, preferSave: "folder" };
    let err: unknown = null;
    try {
      planRender({ format: "png", w: 10, h: 10, bytes: 100 }, job, LEAN, estimate, () => false);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PlanError);
    expect((err as PlanError).kind).toBe("no-sink");
    expect((err as PlanError).suggestedAction?.length).toBeGreaterThan(0);
  });

  test("estimator refusal and over-budget are PlanErrors", () => {
    const job: JobRequest = { scale: 2, chained4x: false, fileCount: 1, preferSave: "blob" };
    const probe = { format: "png" as const, w: 10, h: 10, bytes: 100 };
    expect(() => planRender(probe, job, RICH, () => 0, () => false)).toThrow(PlanError);
    expect(() =>
      planRender(probe, job, RICH, () => 10 * 2 ** 30, () => false),
    ).toThrow(/exceeds .* ceiling/);
  });

  test("workers respect cores and budget", () => {
    const job: JobRequest = { scale: 2, chained4x: false, fileCount: 1, preferSave: "blob" };
    const probe = { format: "png" as const, w: 10, h: 10, bytes: 100 };
    const one = planRender(probe, job, { ...RICH, logicalCores: 1 }, estimate, () => false);
    expect(one.workers).toBe(1);
    const capped = planRender(
      probe,
      job,
      { ...RICH, logicalCores: 32, deviceMemoryGB: 2 },
      estimate,
      () => false,
    );
    expect(capped.workers).toBeLessThanOrEqual(8);
  });
});
