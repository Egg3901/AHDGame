import { describe, it, expect, beforeEach } from "vitest";
import {
  getCountryArchetypeBuckets,
  clearCountryArchetypeBucketCache,
} from "./countryArchetypeBuckets";
import { archetypeValuesToBuckets, ARCHETYPE_BUCKET_MAP } from "./archetypeBucketMap";
import { getCountryLayer1Model } from "@/lib/seeds/international";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import { getDemographicCategoriesForCountry } from "./countryDemographics";
import type { CountryId } from "@/lib/constants/countries";

const INTL = ["UK", "DE", "JP", "IE", "CN", "BR"];

function realBuckets(cc: string): Set<string> {
  const model = getCountryLayer1Model(cc, eraForPreset("1953-default"))!;
  return new Set(
    model.dims.flatMap((d) => Object.keys(model.turnoutRates[d] ?? {}).map((k) => `${d}:${k}`))
  );
}

describe("per-country archetype→bucket projection", () => {
  beforeEach(() => clearCountryArchetypeBucketCache());

  // The bug this replaced: weights authored in the US vocabulary projected onto
  // buckets the country does not have, so 70-80% of every effect vanished.
  it.each(INTL)("%s: every projected bucket exists in that country's model", (cc) => {
    const table = getCountryArchetypeBuckets(cc)!;
    expect(Object.keys(table).length).toBeGreaterThan(0);
    const real = realBuckets(cc);
    for (const [archetypeId, weights] of Object.entries(table)) {
      for (const w of weights) {
        expect(real.has(`${w.dim}:${w.key}`), `${cc} ${archetypeId} → ${w.dim}:${w.key}`).toBe(
          true
        );
      }
    }
  });

  it.each(INTL)("%s: an effect keeps its full magnitude", (cc) => {
    const table = getCountryArchetypeBuckets(cc)!;
    for (const archetypeId of Object.keys(table)) {
      const projected = archetypeValuesToBuckets({ [archetypeId]: 10 }, cc);
      const total = Object.values(projected).reduce((s, v) => s + v, 0);
      expect(total, `${cc} ${archetypeId}`).toBeCloseTo(10, 6);
    }
  });

  it.each(INTL)("%s: every voter group the country actually uses is mapped", (cc) => {
    const table = getCountryArchetypeBuckets(cc)!;
    const groupIds = getDemographicCategoriesForCountry(cc as CountryId).flatMap((c) =>
      c.groups.map((g) => g.id)
    );
    expect(groupIds.length).toBeGreaterThan(0);
    for (const id of groupIds) {
      expect(Object.keys(table), `${cc} ${id}`).toContain(id);
    }
  });

  it("the US path is unchanged", () => {
    const before = archetypeValuesToBuckets({ college_liberals: 10 });
    expect(archetypeValuesToBuckets({ college_liberals: 10 }, "US")).toEqual(before);
    expect(Object.keys(before).length).toBeGreaterThan(0);
    // The US table must not have picked up foreign dimensions.
    for (const weights of Object.values(ARCHETYPE_BUCKET_MAP)) {
      for (const w of weights) {
        expect(["race", "age", "education", "wealth"]).toContain(w.dim);
      }
    }
  });

  // Ids collide across countries (`retirees` is both US and UK). Passing the
  // country has to pick the country's own decomposition, not the US one.
  it("resolves a colliding id by country, not by first match", () => {
    const us = archetypeValuesToBuckets({ retirees: 10 }, "US");
    const uk = archetypeValuesToBuckets({ retirees: 10 }, "UK");
    expect(Object.keys(uk).length).toBeGreaterThan(0);
    expect(uk).not.toEqual(us);
    const real = realBuckets("UK");
    for (const id of Object.keys(uk)) expect(real.has(id)).toBe(true);
  });

  it("returns null for a country with no Layer-1 model", () => {
    expect(getCountryArchetypeBuckets("ZZ")).toBeNull();
  });
});
