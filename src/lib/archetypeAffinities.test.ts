/**
 * Unit tests for the shift-impact calculation.
 *
 * `calculateShiftImpacts` returns Layer-1 census BUCKET impacts now, not
 * archetype impacts, so every assertion here names a bucket. The archetype
 * tables this module still exports are the record of where the bucket values
 * in `bucketAffinities.ts` were projected from; nothing reads them at runtime.
 */

import { describe, it, expect } from "vitest";
import {
  calculateShiftImpacts,
  getDomainForPolicyDomain,
  DOMAIN_AFFINITIES,
  SHIFT_IMPACT_SCALE,
} from "./archetypeAffinities";
import { DOMAIN_BUCKET_AFFINITIES } from "./bucketAffinities";
import { turnoutTargetIdsForCountry } from "./demographics/turnoutTargets";

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
    // tables. A missing table must yield no impacts rather than crashing the
    // Propose Legislation modal (Object.entries(undefined) → "Something went
    // wrong"). Regression guard for the CN propose crash.
    expect(() => calculateShiftImpacts("agriculture", 3, 5, "CN")).not.toThrow();
    expect(() => calculateShiftImpacts("technology", 3, 5, "CN")).not.toThrow();
    expect(() => calculateShiftImpacts("agriculture", 3, 5)).not.toThrow();
    expect(calculateShiftImpacts("agriculture", 3, 5, "CN")).toEqual({});
    expect(calculateShiftImpacts("technology", 3, 5, "DE")).toEqual({});
  });

  it("calculates positive impacts for rightward shift with positive affinity", () => {
    // Education: `race:white` carries +41 (evangelicals and rural
    // traditionalists both project onto it, and their affinities sum).
    // Shift right by 2, ending at position 3 (center, 0.5x multiplier)
    // impact = 2 * 41 * 0.15 * 0.5 = 6.15 -> rounds to 6
    const impacts = calculateShiftImpacts("education", 1, 3);
    expect(impacts["race:white"]).toBe(6);
  });

  it("calculates negative impacts for rightward shift with negative affinity", () => {
    // Education: `education:graduate` carries -29.5 (public sector and secular
    // professionals). impact = 2 * -29.5 * 0.15 * 0.5 = -4.425 -> -4
    const impacts = calculateShiftImpacts("education", 1, 3);
    expect(impacts["education:graduate"]).toBe(-4);
  });

  it("calculates impacts correctly for leftward shifts", () => {
    const right = calculateShiftImpacts("education", 1, 3);
    const left = calculateShiftImpacts("education", 5, 3);
    // Same magnitude, opposite sign — the shift term is the only thing that
    // changes and it is linear.
    expect(left["race:white"]).toBe(-right["race:white"]);
    expect(left["education:graduate"]).toBe(-right["education:graduate"]);
  });

  it("clamps impacts to ±10 range", () => {
    const impacts = calculateShiftImpacts("healthcare", 0, 6);
    expect(impacts["race:white"]).toBe(10);
    expect(impacts["wealth:low"]).toBe(-10);

    const impactsLeft = calculateShiftImpacts("healthcare", 6, 0);
    expect(impactsLeft["race:white"]).toBe(-10);
    expect(impactsLeft["wealth:low"]).toBe(10);
  });

  it("produces different impacts across different domains", () => {
    const educationImpacts = calculateShiftImpacts("education", 3, 4);
    const environmentImpacts = calculateShiftImpacts("environment", 3, 4);

    // Environment is the most polarizing domain on the education axis (climate
    // regulation splits graduates from non-graduates harder than school choice
    // does), so the same one-step shift moves graduates further.
    expect(Math.abs(environmentImpacts["education:graduate"])).toBeGreaterThan(
      Math.abs(educationImpacts["education:graduate"])
    );
  });

  it("excludes buckets whose summed affinity rounds to nothing", () => {
    // criminal_justice has no wealth:high term at all: only small_business and
    // secular_professionals carry that bucket, and their affinities (+15 and
    // -25) do not both appear in this domain's mix at a magnitude that survives
    // the round.
    const impacts = calculateShiftImpacts("publicSafety", 3, 5);
    expect(impacts["wealth:high"]).toBeUndefined();
  });

  it("handles immigration domain with extreme polarization", () => {
    // new_immigrants carried -50 and projected almost entirely onto the
    // non-white race buckets, which is why hispanic is the sharpest negative.
    const impacts = calculateShiftImpacts("immigration", 3, 5);
    expect(impacts["race:hispanic"]).toBe(-9);
    // rural_traditionalists carried +40 onto no_college, which nets positive
    // even against the immigrant-projected negatives sharing that bucket.
    expect(impacts["education:no_college"]).toBe(8);
  });

  it("handles small shifts with proportional impacts", () => {
    const impacts = calculateShiftImpacts("economic", 3, 4);
    expect(impacts["wealth:high"]).toBe(2);
    expect(impacts["wealth:low"]).toBe(-3);
  });

  it("uses DE-specific buckets for German bills", () => {
    // Germany's model has ethnicity/income/urbanization, not race/wealth — a
    // German bill must not come back keyed on US buckets.
    const impacts = calculateShiftImpacts("immigration", 3, 5, "DE");

    expect(impacts["ethnicity:turkish_russian_diaspora"]).toBe(-7);
    expect(impacts["urbanization:rural"]).toBe(6);
    expect(impacts["race:white"]).toBeUndefined();
    expect(impacts["wealth:low"]).toBeUndefined();
  });

  it("routes labor policy through the DE economic table", () => {
    const impacts = calculateShiftImpacts("labor", 3, 4, "DE");

    expect(impacts["income:high"]).toBe(4);
    expect(impacts["urbanization:urban"]).toBe(-3);
  });
});

describe("DOMAIN_BUCKET_AFFINITIES coverage", () => {
  it("defines all 13 policy domains for every country", () => {
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

    for (const [countryId, table] of Object.entries(DOMAIN_BUCKET_AFFINITIES)) {
      for (const domain of expectedDomains) {
        expect(table[domain], `${countryId}.${domain}`).toBeDefined();
      }
    }
  });

  it("names only buckets that country's electorate has", () => {
    // The failure this guards against is silent: a bucket the model does not
    // have projects onto no cell and the whole effect vanishes, which is
    // exactly how every non-US archetype approval used to be lost.
    const offenders: string[] = [];
    for (const [countryId, table] of Object.entries(DOMAIN_BUCKET_AFFINITIES)) {
      const valid = turnoutTargetIdsForCountry(countryId);
      for (const [domain, affinities] of Object.entries(table)) {
        for (const bucketId of Object.keys(affinities)) {
          if (!valid.has(bucketId)) offenders.push(`${countryId}.${domain}: ${bucketId}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps affinities in a sane range", () => {
    // Wider than the archetype tables' ±50 on purpose: where two archetypes
    // shared a bucket their affinities summed, which is what the engine already
    // computed at read time.
    for (const table of Object.values(DOMAIN_BUCKET_AFFINITIES)) {
      for (const affinities of Object.values(table)) {
        for (const value of Object.values(affinities)) {
          expect(value).toBeGreaterThanOrEqual(-100);
          expect(value).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe("DOMAIN_AFFINITIES (historical archetype tables)", () => {
  it("still holds valid values in the documented range", () => {
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
