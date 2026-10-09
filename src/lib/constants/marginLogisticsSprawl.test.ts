import { describe, it, expect } from "vitest";
import {
  computeAllMarginModifiers,
  isSprawlExemptSectorType,
  type CorporationType,
  type StateMetricValues,
} from "./corporations";

// Ticket 1401: logistics sectors never pay the sprawl penalty on their own
// margin, but they still count toward the corporation's sector total.

const NEUTRAL_METRICS: StateMetricValues = {
  fullMetrics: null,
  unemploymentRate: null,
  gridReliability: null,
  corruptionIndex: null,
  workforceSkill: null,
  crimeRate: null,
  broadbandAccess: null,
  roadCondition: null,
  carbonEmissions: null,
  costOfLiving: null,
};

function sprawlFor(sectorType: CorporationType, totalSectors: number) {
  return computeAllMarginModifiers(
    sectorType,
    30,
    NEUTRAL_METRICS,
    0,
    0,
    "logistics",
    totalSectors,
    undefined,
    0,
    null
  ).sprawlModifier;
}

describe("logistics sector sprawl exemption (ticket 1401)", () => {
  it("only the logistics sector type is exempt", () => {
    expect(isSprawlExemptSectorType("logistics")).toBe(true);
    expect(isSprawlExemptSectorType("energy")).toBe(false);
  });

  it("a logistics sector carries no sprawl at any sector count", () => {
    expect(sprawlFor("logistics", 51)).toBe(0);
  });

  it("other sectors in the same corp keep the full penalty, counting depots", () => {
    expect(sprawlFor("energy", 51)).toBe(-9);
  });
});
