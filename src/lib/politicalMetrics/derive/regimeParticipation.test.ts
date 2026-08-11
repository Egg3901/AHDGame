import { describe, expect, it } from "vitest";
import {
  ONE_PARTY_PARTICIPATION_CEILING,
  hasSingleSlateElections,
  regimeAdjustedParticipation,
} from "./regimeParticipation";

describe("hasSingleSlateElections", () => {
  it("covers the Cold-War bloc and the one-party states", () => {
    for (const c of ["HU", "PL", "RO", "BG", "CS", "YU", "BLR", "BAL", "CN"]) {
      expect(hasSingleSlateElections(c), c).toBe(true);
    }
  });

  it("is false for competitive-election countries and unknown ids", () => {
    for (const c of ["AT", "IT", "SE", "IE", "JP", "DE", "FR", "US", "UK", "ZZ"]) {
      expect(hasSingleSlateElections(c), c).toBe(false);
    }
  });
});

describe("regimeAdjustedParticipation", () => {
  it("is the identity for a competitive-election country", () => {
    // Parity: a genuine 95%-turnout democracy keeps the score it earned.
    for (const score of [0, 37.8, 82.2, 100]) {
      expect(regimeAdjustedParticipation(score, "AT")).toBe(score);
    }
  });

  it("puts a single-slate landslide at the ceiling, not at the top of the scale", () => {
    // The defect: ~99% compelled turnout scored 100, i.e. the best political
    // participation in the world.
    expect(regimeAdjustedParticipation(100, "HU")).toBe(ONE_PARTY_PARTICIPATION_CEILING);
    expect(regimeAdjustedParticipation(100, "HU")).toBeLessThan(
      regimeAdjustedParticipation(100, "AT")
    );
  });

  it("still ORDERS one-party states by turnout — compression, not a clamp", () => {
    // A hard clamp would flatten all nine bloc states onto one number and trade
    // one kind of saturation for another.
    const high = regimeAdjustedParticipation(100, "PL");
    const mid = regimeAdjustedParticipation(70, "PL");
    const low = regimeAdjustedParticipation(40, "PL");
    expect(high).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(low);
  });

  it("keeps a floor above zero — mass mobilisation is real participation", () => {
    expect(regimeAdjustedParticipation(100, "CN")).toBeGreaterThan(50);
  });

  it("passes a non-finite score straight through", () => {
    expect(Number.isNaN(regimeAdjustedParticipation(Number.NaN, "HU"))).toBe(true);
  });
});
