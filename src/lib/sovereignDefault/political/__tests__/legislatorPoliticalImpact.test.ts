import { describe, it, expect } from "vitest";
import { computeLegislatorImpact } from "../legislatorPoliticalImpact";

describe("computeLegislatorImpact", () => {
  it("populist voting FOR repudiate is rewarded", () => {
    expect(computeLegislatorImpact("populist", "for", "repudiate")).toBe(8);
  });

  it("populist voting AGAINST repudiate is penalized half-magnitude", () => {
    expect(computeLegislatorImpact("populist", "against", "repudiate")).toBe(-4);
  });

  it("technocrat voting FOR repudiate is heavily punished", () => {
    expect(computeLegislatorImpact("technocrat", "for", "repudiate")).toBe(-10);
  });

  it("technocrat voting AGAINST repudiate gets a positive bump (their base agrees)", () => {
    // -aligned/2 where aligned is -10 → 5
    expect(computeLegislatorImpact("technocrat", "against", "repudiate")).toBe(5);
  });

  it("conservative voting FOR bailout is rewarded", () => {
    expect(computeLegislatorImpact("conservative", "for", "bailout")).toBe(5);
  });

  it("centrist voting FOR monetize is neutral (0)", () => {
    expect(computeLegislatorImpact("centrist", "for", "monetize")).toBe(0);
  });

  it("unknown ideology falls back to averaged deltas", () => {
    const r = computeLegislatorImpact("unknown", "for", "repudiate");
    // Average of repudiate column: (8 + 10 + (-10) + (-3) + 3 + (-8)) / 6 = 0
    expect(r).toBe(0);
  });

  it("unknown ideology voting FOR bailout gets averaged value", () => {
    const r = computeLegislatorImpact("unknown", "for", "bailout");
    // Average: (-3 + -3 + 5 + 2 + -1 + 5) / 6 = 5/6 ≈ 0.833
    expect(r).toBeCloseTo(5 / 6, 5);
  });
});
