import { describe, expect, it } from "vitest";
import { advanceOutputGap, OUTPUT_GAP_BOUND } from "./outputGap";

const TPY = 48;

describe("advanceOutputGap", () => {
  it("steady (sector=potential, gap=0) → gap stays 0, gdpGrowth=potential", () => {
    const r = advanceOutputGap(0, 3, 3, TPY);
    expect(r.gap).toBeCloseTo(0, 9);
    expect(r.gdpGrowth).toBeCloseTo(3, 9);
    expect(r.impulse).toBeCloseTo(0, 9);
  });
  it("a sector boom opens a positive gap and lifts gdpGrowth this turn", () => {
    const r = advanceOutputGap(0, 7, 3, TPY); // sector 4 above potential
    expect(r.gap).toBeGreaterThan(0);
    expect(r.gdpGrowth).toBeGreaterThan(3);
  });
  it("a positive gap with sector back at potential → gdpGrowth below potential (bust) + gap shrinks", () => {
    const r = advanceOutputGap(8, 3, 3, TPY); // prevGap 8, sector=potential
    expect(r.gdpGrowth).toBeLessThan(3);
    expect(r.gap).toBeLessThan(8);
  });
  it("clamps the gap and stays finite on non-finite input", () => {
    expect(advanceOutputGap(1e9, 50, 3, TPY).gap).toBeLessThanOrEqual(OUTPUT_GAP_BOUND[1]);
    expect(advanceOutputGap(-1e9, -50, 3, TPY).gap).toBeGreaterThanOrEqual(OUTPUT_GAP_BOUND[0]);
    expect(Number.isFinite(advanceOutputGap(NaN, NaN, NaN, TPY).gdpGrowth)).toBe(true);
  });

  it("bounds growth and reconciles the gap when the integrated rate would exceed 15%", () => {
    const r = advanceOutputGap(-10, 10, 2, TPY);

    expect(r.gdpGrowth).toBeCloseTo(15, 9);
    expect(r.gap).toBeCloseTo(-10 + (15 - 2) / TPY, 9);
    expect(r.gdpGrowth).toBeCloseTo(2 + (r.gap - -10) * TPY, 9);
  });

  it("applies the same reconciliation at the lower growth boundary", () => {
    const r = advanceOutputGap(10, -10, 2, TPY);

    expect(r.gdpGrowth).toBeCloseTo(-15, 9);
    expect(r.gap).toBeCloseTo(10 + (-15 - 2) / TPY, 9);
    expect(r.gdpGrowth).toBeCloseTo(2 + (r.gap - 10) * TPY, 9);
  });
});
