import { describe, expect, it, vi } from "vitest";
import { applyBounds, roundTo, applyCircuitBreaker } from "./bounds";

describe("applyBounds", () => {
  it("clamps to [min,max] including negatives", () => {
    expect(applyBounds(-9, [-3, 5])).toBe(-3);
    expect(applyBounds(99, [-3, 5])).toBe(5);
    expect(applyBounds(2, [-3, 5])).toBe(2);
  });
});

describe("roundTo", () => {
  it("rounds to N decimals", () => {
    expect(roundTo(1.23456, 3)).toBe(1.235);
  });
  it("rounds to 0 decimals", () => {
    expect(roundTo(2.6, 0)).toBe(3);
  });
});

describe("applyCircuitBreaker", () => {
  it("caps per-turn movement and logs when exceeded", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(applyCircuitBreaker(50, 90, 10, "e.x", "s1")).toBe(60); // capped to prev+10
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("caps negative moves symmetrically", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(applyCircuitBreaker(50, 10, 10, "e.x", "s1")).toBe(40); // capped to prev-10
    warn.mockRestore();
  });
  it("passes through within-threshold moves without logging", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(applyCircuitBreaker(50, 55, 10, "e.x", "s1")).toBe(55);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
