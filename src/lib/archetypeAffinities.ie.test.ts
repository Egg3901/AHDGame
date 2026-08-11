import { describe, expect, it } from "vitest";
import { IE_DOMAIN_AFFINITIES } from "./archetypeAffinities";

const POLICY_DOMAINS = [
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

const IE_ARCHETYPES = [
  "urban_professional",
  "rural_traditional",
  "working_class",
  "new_irish",
  "small_business",
  "retirees",
  "young_urban",
  "border_communities",
] as const;

describe("IE_DOMAIN_AFFINITIES", () => {
  it("covers all 13 PolicyDomain values", () => {
    for (const domain of POLICY_DOMAINS) {
      expect(IE_DOMAIN_AFFINITIES[domain], `missing domain ${domain}`).toBeDefined();
    }
  });

  it("covers all 8 IE archetypes for each domain", () => {
    for (const domain of POLICY_DOMAINS) {
      const table = IE_DOMAIN_AFFINITIES[domain] as Record<string, number>;
      for (const archetype of IE_ARCHETYPES) {
        expect(table[archetype], `${domain}.${archetype} should be defined`).toBeDefined();
      }
    }
  });

  it("values are finite and within [-100, +100]", () => {
    for (const domain of POLICY_DOMAINS) {
      const table = IE_DOMAIN_AFFINITIES[domain] as Record<string, number>;
      for (const archetype of IE_ARCHETYPES) {
        const value = table[archetype];
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(-100);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });
});
