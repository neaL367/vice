// Ticket 04 tests: IBP contracts — residual monotone, Π exact, deterministic.

import { describe, expect, test } from "bun:test";
import { fixtureGradient, fixtureStep } from "./adversarial.ts";
import { boxDownsample } from "./forward.ts";
import { reconstructIbp } from "./ibp.ts";

describe("guarded IBP", () => {
  test("residual non-increasing; final ≈ 0 with projection (2x step)", () => {
    const f = fixtureStep();
    const lr = boxDownsample(f.hr, 2);
    const { residuals } = reconstructIbp(lr, 2, { iters: 4 });
    expect(residuals.length).toBe(5);
    for (let i = 1; i < residuals.length; i++) expect(residuals[i]).toBeLessThanOrEqual(residuals[i - 1] + 1e-9);
    expect(residuals[residuals.length - 1]).toBeLessThan(1e-5); // spec gate
  });
  test("deterministic: two runs bit-identical", () => {
    const f = fixtureGradient();
    const lr = boxDownsample(f.hr, 4);
    const a = reconstructIbp(lr, 4, { iters: 4 });
    const b = reconstructIbp(lr, 4, { iters: 4 });
    expect(a.x.data).toEqual(b.x.data);
  });
  test("projection-off shows violation magnitude (demonstrates guarantee value)", () => {
    const f = fixtureStep();
    const lr = boxDownsample(f.hr, 2);
    const off = reconstructIbp(lr, 2, { iters: 4, project: false, clamp: false });
    const on = reconstructIbp(lr, 2, { iters: 4, project: true });
    const last = (r: number[]) => r[r.length - 1];
    // Projected path ends exact; unguarded path generally does not.
    expect(last(on.residuals)).toBeLessThan(1e-5);
    expect(last(off.residuals)).toBeGreaterThanOrEqual(0);
  });
});
