/**
 * Every seeded voter group, in every country, must project onto Layer-1 buckets.
 *
 * `archetypeValuesToBuckets` used to drop an unmapped id silently, and the map
 * covered the 12 US archetypes only. On every other world an archetype-keyed
 * approval or favorability effect landed on nothing and vanished — a Governor's
 * Address delivered, charged and expired while moving zero votes.
 *
 * This is the gate that stops that returning. A new country seed, or a new
 * group in an existing one, fails here until it has a mapping.
 */
import { describe, expect, it } from "vitest";
import { ARCHETYPE_BUCKET_MAP, archetypeValuesToBuckets } from "./archetypeBucketMap";
import { getCountryArchetypeBuckets } from "./countryArchetypeBuckets";
import { GRANULAR_DIMENSIONS } from "./granularCells";
import { getCountryLayer1Model } from "@/lib/seeds/international";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import { atDemographicCategories } from "@/lib/seeds/at/atDemographicCategories";
import { brDemographicCategories } from "@/lib/seeds/br/brDemographicCategories";
import { cnDemographicCategories } from "@/lib/seeds/cn/cnDemographicCategories";
import { ddDemographicCategories } from "@/lib/seeds/dd/ddDemographicCategories";
import { deDemographicCategories } from "@/lib/seeds/de/deDemographicCategories";
import { esDemographicCategories } from "@/lib/seeds/es/esDemographicCategories";
import { fiDemographicCategories } from "@/lib/seeds/fi/fiDemographicCategories";
import { frDemographicCategories } from "@/lib/seeds/fr/frDemographicCategories";
import { grDemographicCategories } from "@/lib/seeds/gr/grDemographicCategories";
import { ieDemographicCategories } from "@/lib/seeds/ie/ieDemographicCategories";
import { itDemographicCategories } from "@/lib/seeds/it/itDemographicCategories";
import { jpDemographicCategories } from "@/lib/seeds/jp/jpDemographicCategories";
import { ngDemographicCategories } from "@/lib/seeds/ng/ngDemographicCategories";
import { ruDemographicCategories } from "@/lib/seeds/ru/ruDemographicCategories";
import { seDemographicCategories } from "@/lib/seeds/se/seDemographicCategories";
import { trDemographicCategories } from "@/lib/seeds/tr/trDemographicCategories";
import { ukDemographicCategories } from "@/lib/seeds/uk/ukDemographicCategories";
import { makeEasternBlocCategories } from "@/lib/seeds/shared/easternBlocModel";
import { ALL_COUNTRY_IDS } from "@/lib/constants/countries";

type Cats = Array<{ groups?: Array<{ id: string }> }>;

const BY_COUNTRY: Record<string, Cats> = {
  AT: atDemographicCategories as Cats,
  BR: brDemographicCategories as Cats,
  CN: cnDemographicCategories as Cats,
  DD: ddDemographicCategories as Cats,
  DE: deDemographicCategories as Cats,
  ES: esDemographicCategories as Cats,
  FI: fiDemographicCategories as Cats,
  FR: frDemographicCategories as Cats,
  GR: grDemographicCategories as Cats,
  IE: ieDemographicCategories as Cats,
  IT: itDemographicCategories as Cats,
  JP: jpDemographicCategories as Cats,
  NG: ngDemographicCategories as Cats,
  RU: ruDemographicCategories as Cats,
  SE: seDemographicCategories as Cats,
  TR: trDemographicCategories as Cats,
  UK: ukDemographicCategories as Cats,
  // Devolved nations have no catalog of their own: they inherit the UK's
  // twelve voter groups (see `regionData.ts`'s CATEGORY_BY_COUNTRY).
  SCO: ukDemographicCategories as Cats,
  WAL: ukDemographicCategories as Cats,
  // Eastern bloc: nine generated catalogs, all six-group, all built from the
  // shared model. Their absence from this map is why Ukraine's effects were
  // silently discarded while this gate stayed green.
  HU: makeEasternBlocCategories("hu_voterGroups", "Hungary Voter Groups") as Cats,
  PL: makeEasternBlocCategories("pl_voterGroups", "Poland Voter Groups") as Cats,
  RO: makeEasternBlocCategories("ro_voterGroups", "Romania Voter Groups") as Cats,
  YU: makeEasternBlocCategories("yu_voterGroups", "Yugoslavia Voter Groups") as Cats,
  BG: makeEasternBlocCategories("bg_voterGroups", "Bulgaria Voter Groups") as Cats,
  BLR: makeEasternBlocCategories("blr_voterGroups", "Belarus Voter Groups") as Cats,
  UKR: makeEasternBlocCategories("ua_voterGroups", "Ukraine Voter Groups") as Cats,
  CS: makeEasternBlocCategories("cs_voterGroups", "Czechoslovakia Voter Groups") as Cats,
  BAL: makeEasternBlocCategories("bal_voterGroups", "Baltics Voter Groups") as Cats,
};

function groupIds(cats: Cats): string[] {
  return cats.flatMap((c) => (c.groups ?? []).map((g) => g.id));
}

describe("archetype bucket coverage", () => {
  // The gate on the gate. Ukraine was missing from both this map and the
  // composition generator, so 100% of its archetype-keyed effects projected
  // onto nothing while every assertion below stayed green. Pinning the key
  // set to the real country universe means a new country cannot be added
  // without a mapping again.
  it("covers every country except the US, which has its own table", () => {
    const expected = ALL_COUNTRY_IDS.filter((id) => id !== "US")
      .map(String)
      .sort();
    expect(Object.keys(BY_COUNTRY).sort()).toEqual(expected);
  });

  it("every seeded voter group in every country has a mapping", () => {
    const missing: string[] = [];
    for (const [country, cats] of Object.entries(BY_COUNTRY)) {
      // Non-US groups resolve through their own country's seeded composition;
      // the US table is the US vocabulary only.
      const table = getCountryArchetypeBuckets(country) ?? ARCHETYPE_BUCKET_MAP;
      for (const id of groupIds(cats)) {
        if (!table[id]) missing.push(`${country}:${id}`);
      }
    }
    expect(
      missing,
      "These groups project onto nothing, so every targeted effect on that " +
        "world is silently discarded. Add them to that country's seed " +
        "`composition` table (or archetypeBucketMap.ts for the US)."
    ).toEqual([]);
  });

  it("a targeted effect keeps its full magnitude in every country", () => {
    // Weights summing to 1 is what guarantees the projection is lossless.
    for (const [country, cats] of Object.entries(BY_COUNTRY)) {
      for (const id of groupIds(cats)) {
        const total = Object.values(archetypeValuesToBuckets({ [id]: 10 }, country)).reduce(
          (s, v) => s + v,
          0
        );
        expect(total, `${country}:${id} lost magnitude`).toBeCloseTo(10, 6);
      }
    }
  });

  // The check that was missing before, and the reason non-US effects vanished
  // while the coverage test above was green: a mapping can exist and still name
  // a bucket the country's electorate does not have.
  it("every mapping names a bucket its own country actually has", () => {
    for (const country of Object.keys(BY_COUNTRY)) {
      const table = getCountryArchetypeBuckets(country);
      if (!table) continue;
      const model = getCountryLayer1Model(country, eraForPreset("1953-default"));
      if (!model) continue;
      const real = new Set(
        model.dims.flatMap((d) => Object.keys(model.turnoutRates[d] ?? {}).map((k) => `${d}:${k}`))
      );
      for (const [id, weights] of Object.entries(table)) {
        for (const { dim, key } of weights) {
          expect(real.has(`${dim}:${key}`), `${country}:${id} → ${dim}:${key}`).toBe(true);
        }
      }
    }
  });

  it("the US mapping uses real cell dimensions and positive weights", () => {
    const validDims = new Set<string>(GRANULAR_DIMENSIONS);
    for (const [id, weights] of Object.entries(ARCHETYPE_BUCKET_MAP)) {
      expect(weights.length, `${id} has no buckets`).toBeGreaterThan(0);
      for (const { dim, w } of weights) {
        expect(validDims.has(dim), `${id} uses unknown dim ${dim}`).toBe(true);
        expect(w, `${id} weight`).toBeGreaterThan(0);
      }
      expect(
        weights.reduce((s, w) => s + w.w, 0),
        `${id} weights must sum to 1`
      ).toBeCloseTo(1, 6);
    }
  });

  it("is non-vacuous — the country tables actually contain groups", () => {
    for (const [country, cats] of Object.entries(BY_COUNTRY)) {
      expect(groupIds(cats).length, `${country} has no seeded groups`).toBeGreaterThan(0);
    }
  });
});
