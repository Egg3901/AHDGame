import { describe, it, expect } from "vitest";
import {
  NPC_BASELINE_PREFERENCE,
  NPC_GOVERNMENT_MODIFIER,
  NPC_IDEOLOGY_MODIFIER,
} from "../npcConstants";

describe("NPC tunables", () => {
  it("baseline preferences cover all four resolution choices", () => {
    expect(Object.keys(NPC_BASELINE_PREFERENCE).sort()).toEqual([
      "bailout",
      "monetize",
      "repudiate",
      "restructure",
    ]);
  });

  it("government modifiers entries cover authoritarian, democracy, hybrid", () => {
    expect(Object.keys(NPC_GOVERNMENT_MODIFIER).sort()).toEqual([
      "authoritarian",
      "democracy",
      "hybrid",
    ]);
  });

  it("each government modifier covers all four resolution choices", () => {
    for (const govt of Object.keys(NPC_GOVERNMENT_MODIFIER)) {
      const entries = NPC_GOVERNMENT_MODIFIER[govt as keyof typeof NPC_GOVERNMENT_MODIFIER];
      expect(Object.keys(entries).sort()).toEqual([
        "bailout",
        "monetize",
        "repudiate",
        "restructure",
      ]);
    }
  });

  it("ideology modifiers cover the six ideology buckets", () => {
    expect(Object.keys(NPC_IDEOLOGY_MODIFIER).sort()).toEqual([
      "centrist",
      "conservative",
      "nationalist",
      "populist",
      "socialist",
      "technocrat",
    ]);
  });

  it("modifier magnitudes stay within sensible bounds (|m| ≤ 0.30)", () => {
    // Baseline preferences are 0.3..0.7. Modifiers must not exceed ±0.30 each so
    // worst-case extremes (baseline + government + ideology) stay within 0..1.3
    // before state modifiers — leaves headroom for D/GDP and reserve-currency bumps.
    for (const govt of Object.values(NPC_GOVERNMENT_MODIFIER)) {
      for (const v of Object.values(govt)) expect(Math.abs(v)).toBeLessThanOrEqual(0.3);
    }
    for (const ideo of Object.values(NPC_IDEOLOGY_MODIFIER)) {
      for (const v of Object.values(ideo)) expect(Math.abs(v)).toBeLessThanOrEqual(0.3);
    }
  });
});
