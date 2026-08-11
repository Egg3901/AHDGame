import { describe, it, expect } from "vitest";
import { computeLocalSectorMarginPenalty } from "../localPenalty";
import {
  DEFAULT_MARGIN_PENALTY_REPUDIATE,
  DEFAULT_MARGIN_FULL_PENALTY_TURNS,
  DEFAULT_MARGIN_DECAY_TURNS,
} from "../../constants";

describe("computeLocalSectorMarginPenalty", () => {
  it("returns 0 for foreign corps (delegates to global layer)", () => {
    expect(
      computeLocalSectorMarginPenalty({
        corpCountryId: "JP",
        defaultingCountryCode: "US",
        resolutionType: "repudiate",
        corpType: "financial",
        currentTurn: 100,
        lastDefaultTurn: 100,
      })
    ).toBe(0);
  });

  it("returns 0 when lastDefaultTurn is null (never defaulted)", () => {
    expect(
      computeLocalSectorMarginPenalty({
        corpCountryId: "US",
        defaultingCountryCode: "US",
        resolutionType: "repudiate",
        corpType: "financial",
        currentTurn: 100,
        lastDefaultTurn: null,
      })
    ).toBe(0);
  });

  it("returns 0 when past 72-turn full window", () => {
    expect(
      computeLocalSectorMarginPenalty({
        corpCountryId: "US",
        defaultingCountryCode: "US",
        resolutionType: "repudiate",
        corpType: "financial",
        currentTurn: 200,
        lastDefaultTurn: 100,
      })
    ).toBe(0);
  });

  it("during full-penalty window: returns base * sectorMultiplier (no decay)", () => {
    const r = computeLocalSectorMarginPenalty({
      corpCountryId: "US",
      defaultingCountryCode: "US",
      resolutionType: "repudiate",
      corpType: "financial",
      currentTurn: 100,
      lastDefaultTurn: 100,
    });
    expect(r).toBeCloseTo(DEFAULT_MARGIN_PENALTY_REPUDIATE * 1.5);
  });

  it("during decay window: linearly interpolates from full to zero", () => {
    const halfwayThroughDecay = DEFAULT_MARGIN_FULL_PENALTY_TURNS + DEFAULT_MARGIN_DECAY_TURNS / 2;
    const r = computeLocalSectorMarginPenalty({
      corpCountryId: "US",
      defaultingCountryCode: "US",
      resolutionType: "repudiate",
      corpType: "financial",
      currentTurn: 100 + halfwayThroughDecay,
      lastDefaultTurn: 100,
    });
    expect(r).toBeCloseTo(DEFAULT_MARGIN_PENALTY_REPUDIATE * 1.5 * 0.5, 4);
  });

  it("monetize resolution returns 0 (handled by inflation pipeline)", () => {
    expect(
      computeLocalSectorMarginPenalty({
        corpCountryId: "US",
        defaultingCountryCode: "US",
        resolutionType: "monetize",
        corpType: "financial",
        currentTurn: 100,
        lastDefaultTurn: 100,
      })
    ).toBe(0);
  });
});
