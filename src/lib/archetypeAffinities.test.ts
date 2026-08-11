/**
 * Unit tests for archetype affinity calculations
 */

import { describe, it, expect } from "vitest";
import {
  calculateShiftImpacts,
  getDomainForPolicyDomain,
  DOMAIN_AFFINITIES,
  SHIFT_IMPACT_SCALE,
} from "./archetypeAffinities";

describe("getDomainForPolicyDomain", () => {
  it("maps known policy domains correctly", () => {
    expect(getDomainForPolicyDomain("education")).toBe("education");
    expect(getDomainForPolicyDomain("healthcare")).toBe("healthcare");
    expect(getDomainForPolicyDomain("publicSafety")).toBe("criminal_justice");
    expect(getDomainForPolicyDomain("governance")).toBe("governance");
    expect(getDomainForPolicyDomain("labor")).toBe("economic");
  });

  it("defaults to economic for unknown domains", () => {
    expect(getDomainForPolicyDomain("unknown_domain")).toBe("economic");
    expect(getDomainForPolicyDomain("")).toBe("economic");
  });
});

describe("calculateShiftImpacts", () => {
  it("returns empty object when no shift occurs", () => {
    const impacts = calculateShiftImpacts("education", 3, 3);
    expect(impacts).toEqual({});
  });

  it("does not throw for a domain absent from a country's affinity table", () => {
    // `agriculture` and `technology` exist in the PolicyDomain type, the
    // legislation data, and the UK table, but are absent from the US/JP/DE/CN/IE
    // affinity tables. A missing table must yield no archetype impacts rather
    // than crashing the Propose Legislation modal (Object.entries(undefined) →
    // "Something went wrong"). Regression guard for the CN propose crash.
    expect(() => calculateShiftImpacts("agriculture", 3, 5, "CN")).not.toThrow();
    expect(() => calculateShiftImpacts("technology", 3, 5, "CN")).not.toThrow();
    expect(() => calculateShiftImpacts("agriculture", 3, 5)).not.toThrow();
    expect(calculateShiftImpacts("agriculture", 3, 5, "CN")).toEqual({});
    expect(calculateShiftImpacts("technology", 3, 5, "DE")).toEqual({});
  });

  it("calculates positive impacts for rightward shift with positive affinity", () => {
    // Education: evangelicals have +35 affinity (likes rightward)
    // Shift right by 2, ending at position 3 (center, 0.5x multiplier)
    // impact = 2 * 35 * 0.15 * 0.5 = 5.25 -> rounds to 5
    const impacts = calculateShiftImpacts("education", 1, 3);
    expect(impacts.evangelicals).toBe(5);
  });

  it("calculates negative impacts for rightward shift with negative affinity", () => {
    // Education: public_sector has -40 affinity (hates rightward)
    // Shift right by 2, ending at position 3 (center, 0.5x multiplier)
    // impact = 2 * -40 * 0.15 * 0.5 = -6
    const impacts = calculateShiftImpacts("education", 1, 3);
    expect(impacts.public_sector).toBe(-6);
  });

  it("calculates impacts correctly for leftward shifts", () => {
    // Education: evangelicals have +35 affinity
    // Shift left by 2, ending at position 3 (center, 0.5x multiplier)
    // impact = -2 * 35 * 0.15 * 0.5 = -5.25 -> rounds to -5
    const impacts = calculateShiftImpacts("education", 5, 3);
    expect(impacts.evangelicals).toBe(-5);

    // public_sector has -40 affinity (likes leftward)
    // Shift left by 2: impact = -2 * -40 * 0.15 * 0.5 = 6
    expect(impacts.public_sector).toBe(6);
  });

  it("clamps impacts to ±10 range", () => {
    // Large shift in healthcare where libertarians have +40 affinity
    // Shift right by 6: impact = 6 * 40 * 0.15 = 36 -> clamped to 10
    const impacts = calculateShiftImpacts("healthcare", 0, 6);
    expect(impacts.libertarians).toBe(10);

    // Shift left by 6: impact = -6 * 40 * 0.15 = -36 -> clamped to -10
    const impactsLeft = calculateShiftImpacts("healthcare", 6, 0);
    expect(impactsLeft.libertarians).toBe(-10);
  });

  it("produces different impacts across different domains", () => {
    const educationImpacts = calculateShiftImpacts("education", 3, 4);
    const healthcareImpacts = calculateShiftImpacts("healthcare", 3, 4);
    const environmentImpacts = calculateShiftImpacts("environment", 3, 4);

    // Each domain should have different impact patterns
    // Evangelicals: education +35, healthcare +10, environment +15
    expect(educationImpacts.evangelicals).toBeGreaterThan(healthcareImpacts.evangelicals ?? 0);

    // Rural traditionalists: education +15, healthcare +15, environment +40
    expect(environmentImpacts.rural_traditionalists).toBeGreaterThan(
      educationImpacts.rural_traditionalists ?? 0
    );
  });

  it("excludes archetypes with zero affinity", () => {
    // publicSafety maps to criminal_justice domain where public_sector has 0 affinity
    const impacts = calculateShiftImpacts("publicSafety", 3, 5);
    expect(impacts.public_sector).toBeUndefined();
  });

  it("handles immigration domain with extreme polarization", () => {
    // Immigration: new_immigrants have -50 affinity (strongly oppose enforcement)
    // Shift right by 2: impact = 2 * -50 * 0.15 = -15 -> clamped to -10
    const impacts = calculateShiftImpacts("immigration", 3, 5);
    expect(impacts.new_immigrants).toBe(-10);

    // rural_traditionalists have +40 affinity (support enforcement)
    // Shift right by 2: impact = 2 * 40 * 0.15 = 12 -> clamped to 10
    expect(impacts.rural_traditionalists).toBe(10);
  });

  it("handles small shifts with proportional impacts", () => {
    // Small shift of 1 in economic domain
    // small_business has +40 affinity: 1 * 40 * 0.15 = 6
    const impacts = calculateShiftImpacts("economic", 3, 4);
    expect(impacts.small_business).toBe(6);

    // libertarians have +45 affinity: 1 * 45 * 0.15 = 6.75 -> rounds to 7
    expect(impacts.libertarians).toBe(7);
  });

  it("uses DE-specific archetypes for German bills", () => {
    const impacts = calculateShiftImpacts("immigration", 3, 5, "DE");

    expect(impacts.migranten_communities).toBe(-10);
    expect(impacts.protest_waehler_ost).toBe(10);
  });

  it("routes labor policy through the DE economic table", () => {
    const impacts = calculateShiftImpacts("labor", 3, 4, "DE");

    expect(impacts.gewerkschafter).toBe(-5);
    expect(impacts.mittelstand_selbstaendige).toBe(6);
  });
});

describe("DOMAIN_AFFINITIES coverage", () => {
  it("defines all 13 policy domains", () => {
    const expectedDomains = [
      "education",
      "healthcare",
      "environment",
      "immigration",
      "criminal_justice",
      "defense",
      "economic",
      "welfare",
      "infrastructure",
      "governance",
      "foreign_policy",
      "tax",
      "mediaInformation",
    ] as const;

    for (const domain of expectedDomains) {
      expect(DOMAIN_AFFINITIES[domain]).toBeDefined();
    }
  });

  it("has valid affinity values in reasonable range", () => {
    for (const affinities of Object.values(DOMAIN_AFFINITIES)) {
      for (const value of Object.values(affinities)) {
        if (value !== undefined) {
          expect(value).toBeGreaterThanOrEqual(-50);
          expect(value).toBeLessThanOrEqual(50);
        }
      }
    }
  });
});

describe("SHIFT_IMPACT_SCALE", () => {
  it("is set to 0.15", () => {
    expect(SHIFT_IMPACT_SCALE).toBe(0.15);
  });
});
