// Ticket 02 tests: battery determinism + documented LR-domain facts.

import { describe, expect, test } from "bun:test";
import { allFixtures, lcg } from "./adversarial.ts";
import { boxDownsample } from "./forward.ts";

describe("battery", () => {
  test("15 families present, HR divisible by 2 and 4", () => {
    const fs = allFixtures();
    expect(fs.length).toBe(15);
    for (const f of fs) {
      expect(f.hr.w % 4).toBe(0);
      expect(f.hr.h % 4).toBe(0);
      expect(f.property.length).toBeGreaterThan(20);
    }
  });
  test("checkerboard + nyquist vanish under box-D (total nullspace — documented)", () => {
    const fs = allFixtures();
    for (const name of ["checkerboard", "nyquist-stripes"]) {
      const f = fs.find((g) => g.name === name)!;
      const lr = boxDownsample(f.hr, 2);
      for (const v of lr.data) expect(Math.abs(v - 127.5)).toBeLessThan(1e-9);
    }
  });
  test("noise deterministic across calls (seeded LCG)", () => {
    const a = lcg(7);
    const b = lcg(7);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
  test("step/gradient survive D with exact known values", () => {
    const fs = allFixtures();
    const step = fs.find((f) => f.name === "step-edge")!;
    const lr = boxDownsample(step.hr, 2);
    // LR columns left of edge 0, right 255 (edge at HR x=16 → LR x=8)
    expect(lr.data[0]).toBe(0);
    expect(lr.data[lr.w - 1]).toBe(255);
  });
});
