import { describe, it, expect } from "vitest";
import { calculateShiftImpacts } from "./archetypeAffinities";

/**
 * CN bills must come back in CHINA'S bucket vocabulary
 * (`ethnicity / age / education / income / urbanization`, with China's own
 * keys), never in the US one. A US bucket on a CN bill lands on no cell and the
 * effect disappears silently — the same class of failure the archetype tables
 * had, just one layer down, so it is worth pinning explicitly.
 */
describe("CN bucket affinities via calculateShiftImpacts", () => {
  it("returns CN bucket impacts (not the US fallback) for CN bills in the tax domain", () => {
    // Rightward shift (oldIndex 1 → newIndex 5) in tax domain: shift = +4 (rightward)
    const impacts = calculateShiftImpacts("tax", 1, 5, "CN");

    expect(Object.keys(impacts)).toEqual(
      expect.arrayContaining([
        "income:high",
        "income:low",
        "education:university",
        "education:vocational",
        "urbanization:rural",
        "urbanization:urban",
      ])
    );

    // Entrepreneurs carried +35 on tax and are 40% high-income, so the
    // high-income bucket takes the rightward gain.
    expect(impacts["income:high"]).toBeGreaterThan(0);

    // Migrant workers carried -30 and are 35% low-income; rural peasants and
    // industrial workers pull the same way, so low income is sharply negative.
    expect(impacts["income:low"]).toBeLessThan(0);

    // No US buckets — those would mean the US table was used.
    expect(impacts).not.toHaveProperty("race:white");
    expect(impacts).not.toHaveProperty("wealth:high");
    expect(impacts).not.toHaveProperty("education:no_college");
  });

  it("returns no archetype keys of any country", () => {
    const impacts = calculateShiftImpacts("healthcare", 3, 5, "CN");

    for (const key of Object.keys(impacts)) {
      expect(key, `${key} is not a "dim:bucket" id`).toContain(":");
    }
    expect(impacts).not.toHaveProperty("migrant_worker");
    expect(impacts).not.toHaveProperty("rural_traditionalists");
    expect(impacts).not.toHaveProperty("post_industrial_workers");
    expect(impacts).not.toHaveProperty("salaryman_conservative");
    expect(impacts).not.toHaveProperty("wirtschaftsliberale");
  });

  it("rightward governance shifts favour the Party's own demographic", () => {
    // party_cadre carried +30 on governance and is 20% `age:mature`; the
    // younger, more urban buckets that the reform-minded archetypes occupy move
    // the other way.
    const impacts = calculateShiftImpacts("governance", 3, 5, "CN");
    expect(impacts["age:mature"]).toBeGreaterThan(0);
    expect(impacts["age:young"]).toBeLessThan(0);
  });

  it("rightward immigration (Hukou entrenchment) hits the migrant-worker buckets", () => {
    // migrant_worker carried -50 on immigration and is 35% low-income, 30%
    // young, 20% suburban — all three come back negative.
    const impacts = calculateShiftImpacts("immigration", 3, 5, "CN");
    expect(impacts["income:low"]).toBeLessThan(0);
    expect(impacts["age:young"]).toBeLessThan(0);
    expect(impacts["urbanization:suburban"]).toBeLessThan(0);
  });

  it("returns empty impacts when no policy shift occurs", () => {
    const impacts = calculateShiftImpacts("tax", 3, 3, "CN");
    expect(impacts).toEqual({});
  });
});
