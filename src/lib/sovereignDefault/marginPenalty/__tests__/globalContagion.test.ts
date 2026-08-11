import { describe, it, expect } from "vitest";
import { computeGlobalContagionSectorMarginPenalty } from "../globalContagion";
import { DEFAULT_MARGIN_PENALTY_REPUDIATE, GLOBAL_CONTAGION_MULTIPLIER } from "../../constants";

describe("computeGlobalContagionSectorMarginPenalty", () => {
  it("returns 0 for the defaulting country's own corps (local layer handles)", () => {
    expect(
      computeGlobalContagionSectorMarginPenalty({
        corpCountryId: "US",
        defaultingCountryCode: "US",
        defaultingCountryGdp: 27_000_000_000_000,
        globalGdp: 100_000_000_000_000,
        resolutionType: "repudiate",
        corpType: "financial",
        currentTurn: 100,
        lastDefaultTurn: 100,
      })
    ).toBe(0);
  });

  it("returns 0 when globalGdp <= 0 (defensive)", () => {
    expect(
      computeGlobalContagionSectorMarginPenalty({
        corpCountryId: "JP",
        defaultingCountryCode: "US",
        defaultingCountryGdp: 27_000_000_000_000,
        globalGdp: 0,
        resolutionType: "repudiate",
        corpType: "financial",
        currentTurn: 100,
        lastDefaultTurn: 100,
      })
    ).toBe(0);
  });

  it("scales by GDP share × CONTAGION_MULTIPLIER × sector multiplier", () => {
    const r = computeGlobalContagionSectorMarginPenalty({
      corpCountryId: "JP",
      defaultingCountryCode: "US",
      defaultingCountryGdp: 40,
      globalGdp: 100,
      resolutionType: "repudiate",
      corpType: "financial",
      currentTurn: 100,
      lastDefaultTurn: 100,
    });
    const expected = DEFAULT_MARGIN_PENALTY_REPUDIATE * 1.5 * 0.4 * GLOBAL_CONTAGION_MULTIPLIER;
    expect(r).toBeCloseTo(expected, 6);
  });

  it("returns 0 past 72-turn window", () => {
    expect(
      computeGlobalContagionSectorMarginPenalty({
        corpCountryId: "JP",
        defaultingCountryCode: "US",
        defaultingCountryGdp: 40,
        globalGdp: 100,
        resolutionType: "repudiate",
        corpType: "financial",
        currentTurn: 200,
        lastDefaultTurn: 100,
      })
    ).toBe(0);
  });
});
