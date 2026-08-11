import { describe, expect, it } from "vitest";
import { calculateStateLean } from "@/lib/utils/demographics";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types";

/**
 * These pin the failure mode behind #3752: a region's lean is summed only over
 * the categories named in its own `categoryWeights`, so scoring a non-US region
 * against US voter groups matches nothing and yields a silent 0/0 — which reads
 * downstream as "lean not yet derived" and drops the region out of
 * policy-distance scoring entirely.
 */

const ruCategory = {
  _id: "ru_voterGroups",
  groups: [
    { id: "workers", defaultEconomicLean: -3, defaultSocialLean: 2, defaultTurnout: 60 },
    { id: "intelligentsia", defaultEconomicLean: -1, defaultSocialLean: -1, defaultTurnout: 70 },
  ],
} as unknown as DemographicCategory;

const usCategory = {
  _id: "voterGroups",
  groups: [{ id: "suburban", defaultEconomicLean: 2, defaultSocialLean: 1, defaultTurnout: 65 }],
} as unknown as DemographicCategory;

const ruRegion = {
  _id: "UKR",
  countryId: "RU",
  categoryWeights: { ru_voterGroups: 100 },
  groups: {
    workers: { population: 70, economicLean: -3, socialLean: 2, turnout: 60 },
    intelligentsia: { population: 30, economicLean: -1, socialLean: -1, turnout: 70 },
  },
} as unknown as StateDemographics;

describe("calculateStateLean category scoping", () => {
  it("derives a real lean when the region's own categories are supplied", () => {
    const lean = calculateStateLean(ruRegion, [ruCategory]);
    expect(lean.economicLean).toBeLessThan(0);
    expect(lean.economicLean).not.toBe(0);
    expect(lean.socialLean).toBeGreaterThan(0);
  });

  it("silently yields 0/0 when only another country's categories are supplied", () => {
    const lean = calculateStateLean(ruRegion, [usCategory]);
    expect(lean).toEqual({ economicLean: 0, socialLean: 0 });
  });

  it("still derives correctly when other countries' categories are mixed in", () => {
    const scoped = calculateStateLean(ruRegion, [ruCategory]);
    const mixed = calculateStateLean(ruRegion, [usCategory, ruCategory]);
    expect(mixed).toEqual(scoped);
  });
});
