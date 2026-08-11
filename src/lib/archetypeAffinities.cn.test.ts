import { describe, it, expect } from "vitest";
import { calculateShiftImpacts } from "./archetypeAffinities";

describe("CN_DOMAIN_AFFINITIES via calculateShiftImpacts", () => {
  it("returns CN archetype impacts (not US fallback) for CN bills in the tax domain", () => {
    // Rightward shift (oldIndex 1 → newIndex 5) in tax domain: shift = +4 (rightward)
    const impacts = calculateShiftImpacts("tax", 1, 5, "CN");

    expect(Object.keys(impacts)).toEqual(
      expect.arrayContaining([
        "entrepreneur",
        "urban_professional",
        "industrial_worker",
        "migrant_worker",
        "rural_peasant",
        "youth",
      ])
    );

    // entrepreneur affinity is +35 on tax (likes rightward / market liberalization)
    // → shift +4 × +35 × 0.15 scale × position multiplier should be positive
    expect(impacts.entrepreneur).toBeGreaterThan(0);

    // migrant_worker affinity is -30 on tax (likes leftward / state redistribution)
    // → shift +4 × -30 × scale should be negative
    expect(impacts.migrant_worker).toBeLessThan(0);

    // Should NOT contain US archetype IDs (would mean fallback to DOMAIN_AFFINITIES)
    expect(impacts).not.toHaveProperty("evangelicals");
    expect(impacts).not.toHaveProperty("soccer_moms");
    expect(impacts).not.toHaveProperty("libertarians");
  });

  it("returns no US/UK/JP/DE archetype keys when called with CN country", () => {
    const impacts = calculateShiftImpacts("healthcare", 3, 5, "CN");

    // No US archetypes
    expect(impacts).not.toHaveProperty("rural_traditionalists");
    expect(impacts).not.toHaveProperty("retirees");
    // No UK archetypes
    expect(impacts).not.toHaveProperty("post_industrial_workers");
    expect(impacts).not.toHaveProperty("populist_right");
    // No JP archetypes
    expect(impacts).not.toHaveProperty("salaryman_conservative");
    expect(impacts).not.toHaveProperty("komeito_faithful");
    // No DE archetypes
    expect(impacts).not.toHaveProperty("wirtschaftsliberale");
    expect(impacts).not.toHaveProperty("rentner_west");
  });

  it("party_cadre likes rightward governance shifts (more Party authority)", () => {
    // Rightward shift in governance domain
    const impacts = calculateShiftImpacts("governance", 3, 5, "CN");
    // party_cadre affinity is +30 on governance — rightward = strengthen Party
    expect(impacts.party_cadre).toBeGreaterThan(0);
  });

  it("migrant_worker strongly opposes rightward immigration (Hukou entrenchment)", () => {
    // Rightward shift in immigration domain (= Hukou entrenchment)
    const impacts = calculateShiftImpacts("immigration", 3, 5, "CN");
    // migrant_worker affinity is -50 on immigration — strongly likes leftward Hukou liberalization
    expect(impacts.migrant_worker).toBeLessThan(0);
  });

  it("returns empty impacts when no policy shift occurs", () => {
    const impacts = calculateShiftImpacts("tax", 3, 3, "CN");
    expect(impacts).toEqual({});
  });
});
