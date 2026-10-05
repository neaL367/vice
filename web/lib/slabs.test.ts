import { describe, expect, test } from "bun:test";
import { assignSlabs, planSlabs } from "../features/vice/slabs/geometry";

describe("slab geometry", () => {
  test.each([2, 3, 4] as const)("scale %dx: slabs tile exactly, boundaries scale-aligned", (scale) => {
    // outH is always a multiple of scale in reality (outH = in_h * scale).
    for (const outH of [66, 99, 300, 510, 513, 1024, 4096].map((h) => Math.ceil(h / scale) * scale)) {
      const g = planSlabs(256, outH, scale);
      let y = 0;
      for (const s of g.slabs) {
        expect(s.outY0).toBe(y);
        expect(s.outY0 % scale).toBe(0);
        expect(s.outRows % scale).toBe(0);
        expect(s.outRows).toBeGreaterThan(0);
        y += s.outRows;
      }
      expect(y).toBe(outH);
      // Deterministic: same inputs, same slabs.
      expect(planSlabs(256, outH, scale)).toEqual(g);
    }
  });

  test("3x rounds 512 up to a scale multiple", () => {
    const g = planSlabs(256, 2000, 3);
    expect(g.slabs[0].outRows).toBe(513);
    expect(g.slabs[0].outRows % 3).toBe(0);
  });

  test("bad geometry throws", () => {
    expect(() => planSlabs(0, 100, 2)).toThrow();
    expect(() => planSlabs(100, -5, 2)).toThrow();
    expect(() => planSlabs(100, 100, 2, 0)).toThrow();
  });

  test("assignSlabs round-robins and preserves order", () => {
    const g = planSlabs(256, 2048, 2);
    const buckets = assignSlabs(g.slabs, 4);
    expect(buckets.length).toBe(4);
    const flat = buckets.flat();
    expect(flat.length).toBe(g.slabs.length);
    expect(buckets[0][0]).toEqual(g.slabs[0]);
    expect(buckets[1][0]).toEqual(g.slabs[1]);
    expect(assignSlabs(g.slabs, 0).length).toBe(1);
  });
});
