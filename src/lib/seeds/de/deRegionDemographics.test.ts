import { describe, it, expect } from "vitest";
import { deRegionDemographics } from "./deRegionDemographics";
import { deRegions } from "./deRegions";
import { DE_VOTER_GROUP_BASELINES } from "./deDemographicCategories";

const EXPECTED_ARCHETYPE_KEYS = new Set(Object.keys(DE_VOTER_GROUP_BASELINES));

describe("deRegionDemographics", () => {
  it("has one document per Bundesland", () => {
    expect(deRegionDemographics).toHaveLength(deRegions.length);
    const landIds = new Set(deRegions.map((r) => r._id));
    for (const d of deRegionDemographics) {
      expect(landIds.has(d._id)).toBe(true);
    }
  });

  it("all docs use de_voterGroups profile at weight 100", () => {
    for (const d of deRegionDemographics) {
      expect(d.categoryWeights).toEqual({ de_voterGroups: 100 });
      expect(d.countryId).toBe("DE");
    }
  });

  it("every Land exposes all 12 DE archetypes", () => {
    for (const d of deRegionDemographics) {
      const keys = new Set(Object.keys(d.groups));
      expect(keys).toEqual(EXPECTED_ARCHETYPE_KEYS);
    }
  });

  it("population shares sum to 100 per Land", () => {
    for (const d of deRegionDemographics) {
      const total = Object.values(d.groups).reduce((s, g) => s + g.population, 0);
      expect(total).toBe(100);
    }
  });

  it("all population values are non-negative integers", () => {
    for (const d of deRegionDemographics) {
      for (const [archetype, g] of Object.entries(d.groups)) {
        expect(g.population).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(g.population)).toBe(true);
        // Flag unusual spikes (>= 35% of a Land for a single archetype) so
        // future edits can review whether the asymmetry is intentional.
        expect(
          g.population,
          `${d._id}.${archetype} population=${g.population} — unusually high`
        ).toBeLessThan(35);
      }
    }
  });

  it("lean and turnout values are within valid ranges", () => {
    for (const d of deRegionDemographics) {
      for (const g of Object.values(d.groups)) {
        expect(g.economicLean).toBeGreaterThanOrEqual(-5);
        expect(g.economicLean).toBeLessThanOrEqual(5);
        expect(g.socialLean).toBeGreaterThanOrEqual(-5);
        expect(g.socialLean).toBeLessThanOrEqual(5);
        expect(g.turnout).toBeGreaterThan(0);
        expect(g.turnout).toBeLessThanOrEqual(100);
      }
    }
  });

  it("eastern Bundesländer (BE, BB, MV, SN, ST, TH) have higher protest-Wähler concentration than western average", () => {
    const easternIds = new Set(["BE", "BB", "MV", "SN", "ST", "TH"]);
    const westernProtest = deRegionDemographics
      .filter((d) => !easternIds.has(d._id))
      .map((d) => d.groups.protest_waehler_ost.population);
    const easternProtest = deRegionDemographics
      .filter((d) => easternIds.has(d._id))
      .map((d) => d.groups.protest_waehler_ost.population);

    const westAvg = westernProtest.reduce((s, v) => s + v, 0) / westernProtest.length;
    const eastAvg = easternProtest.reduce((s, v) => s + v, 0) / easternProtest.length;
    expect(eastAvg).toBeGreaterThan(westAvg * 3);
  });
});
