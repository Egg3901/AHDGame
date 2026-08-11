import { describe, it, expect } from "vitest";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import {
  GENERIC_FACILITY,
  buildOnePhrase,
  capitalizeFacility,
  facilityPlural,
  facilitySingular,
  facilityVocabulary,
  yourFacilities,
} from "@/lib/constants/facilityVocabulary";

describe("facilityVocabulary", () => {
  it("covers every corporation type with non-empty copy", () => {
    for (const type of CORPORATION_TYPES) {
      const v = facilityVocabulary(type);
      expect(v.singular.length, type).toBeGreaterThan(0);
      expect(v.plural.length, type).toBeGreaterThan(0);
      expect(v.runNoun.length, type).toBeGreaterThan(0);
    }
  });

  it("never calls a non-industrial sector a plant", () => {
    // The whole point of the module: the engine word must not reach the player
    // on a sector where it is wrong.
    for (const type of ["telecommunications", "retail", "financial", "media"] as const) {
      expect(facilityPlural(type)).not.toContain("plant");
      expect(facilitySingular(type)).not.toContain("plant");
    }
  });

  it("keeps the industrial word where it is right", () => {
    expect(facilityPlural("manufacturing")).toBe("plants");
    expect(facilityPlural("automobiles")).toBe("assembly plants");
  });

  it("falls back to the generic instead of throwing on an unknown type", () => {
    expect(facilityVocabulary("not_a_sector")).toBe(GENERIC_FACILITY);
    expect(facilityVocabulary(null)).toBe(GENERIC_FACILITY);
    expect(facilityVocabulary(undefined)).toBe(GENERIC_FACILITY);
    expect(facilityPlural(null)).toBe("facilities");
  });

  it("picks the right article and verb for the build phrase", () => {
    expect(buildOnePhrase("retail")).toBe("open a store");
    expect(buildOnePhrase("defense")).toBe("build an arsenal");
    expect(buildOnePhrase("extraction")).toBe("sink a mine");
  });

  it("takes no article when the noun has no singular form", () => {
    // "works" is its own plural; "build a works" is not English.
    expect(facilitySingular("chemical_industries")).toBe(facilityPlural("chemical_industries"));
    expect(buildOnePhrase("chemical_industries")).toBe("build more works");
  });

  it("capitalizes for sentence-leading use without touching the rest", () => {
    expect(capitalizeFacility("network hubs")).toBe("Network hubs");
    expect(capitalizeFacility("")).toBe("");
  });

  it("builds the panel heading", () => {
    expect(yourFacilities("telecommunications")).toBe("Your network hubs");
    expect(yourFacilities(null)).toBe("Your facilities");
  });
});
