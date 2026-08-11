import { describe, it, expect } from "vitest";
import { scoreColor } from "./scoreColor";

describe("scoreColor", () => {
  it("returns a hex color", () => {
    expect(scoreColor(72)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("maps high scores and low scores to distinct colors", () => {
    expect(scoreColor(95)).not.toEqual(scoreColor(10));
  });

  it("produces distinct colors across the tier boundaries", () => {
    const tiers = [95, 80, 60, 45, 25, 5].map(scoreColor);
    expect(new Set(tiers).size).toBeGreaterThanOrEqual(5);
  });

  it("clamps out-of-range scores without throwing", () => {
    expect(scoreColor(-20)).toMatch(/^#/);
    expect(scoreColor(150)).toMatch(/^#/);
  });
});
