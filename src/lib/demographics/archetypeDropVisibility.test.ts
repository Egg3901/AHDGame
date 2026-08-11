/**
 * Archetype-keyed effects that project onto nothing must be COUNTED, not
 * silently dropped.
 *
 * `ARCHETYPE_BUCKET_MAP` covers the 12 US archetypes only. On a UK, JP or DE
 * world every archetype-keyed approval and favorability value lands on no
 * bucket and disappears: a Governor's Address can be delivered, charged and
 * expired while moving no votes, with no error anywhere.
 *
 * This is the measurement half of retiring archetypes. The effects that need
 * re-authoring into Layer-1 bucket space are exactly the ones counted here.
 */
import { getCountryLayer1Model } from "@/lib/seeds/international";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ARCHETYPE_BUCKET_MAP,
  archetypeValuesToBuckets,
  getUnmappedArchetypeDrops,
  resetUnmappedArchetypeDrops,
} from "./archetypeBucketMap";

describe("unmapped archetype visibility", () => {
  beforeEach(() => resetUnmappedArchetypeDrops());

  it("records an archetype that has no bucket mapping", () => {
    // A UK voter-group id. Nothing in the map matches it.
    archetypeValuesToBuckets({ uk_red_wall: 12 });

    const drops = getUnmappedArchetypeDrops();
    expect(drops).toHaveLength(1);
    expect(drops[0].archetypeId).toBe("uk_red_wall");
    expect(drops[0].count).toBe(1);
    expect(drops[0].magnitude).toBe(12);
  });

  it("accumulates magnitude across calls and sorts by it", () => {
    archetypeValuesToBuckets({ uk_red_wall: 10, jp_salarymen: 3 });
    archetypeValuesToBuckets({ uk_red_wall: 5 });

    const drops = getUnmappedArchetypeDrops();
    expect(drops.map((d) => d.archetypeId)).toEqual(["uk_red_wall", "jp_salarymen"]);
    expect(drops[0]).toMatchObject({ count: 2, magnitude: 15 });
  });

  it("counts magnitude by absolute value, so opposing effects do not cancel", () => {
    // Two real effects that happen to point opposite ways are still two lost
    // effects, not zero.
    archetypeValuesToBuckets({ uk_red_wall: 8 });
    archetypeValuesToBuckets({ uk_red_wall: -8 });
    expect(getUnmappedArchetypeDrops()[0]).toMatchObject({ count: 2, magnitude: 16 });
  });

  it("records nothing for a MAPPED archetype", () => {
    const mapped = Object.keys(ARCHETYPE_BUCKET_MAP)[0];
    const out = archetypeValuesToBuckets({ [mapped]: 10 });

    expect(Object.keys(out).length).toBeGreaterThan(0);
    expect(getUnmappedArchetypeDrops()).toEqual([]);
  });

  it("records nothing for values that were never going to apply", () => {
    // Zero, NaN and non-numeric are skipped before the mapping lookup, so they
    // are not "lost effects" and must not inflate the count.
    archetypeValuesToBuckets({ uk_red_wall: 0 });
    archetypeValuesToBuckets({ uk_red_wall: NaN });
    expect(getUnmappedArchetypeDrops()).toEqual([]);
  });

  it("does not change the projection for mapped archetypes", () => {
    // Pure observability: the numbers this function returns are untouched.
    const mapped = Object.keys(ARCHETYPE_BUCKET_MAP)[0];
    const withUnmapped = archetypeValuesToBuckets({ [mapped]: 10, uk_red_wall: 99 });
    resetUnmappedArchetypeDrops();
    const alone = archetypeValuesToBuckets({ [mapped]: 10 });
    expect(withUnmapped).toEqual(alone);
  });

  it("reset clears the record", () => {
    archetypeValuesToBuckets({ uk_red_wall: 4 });
    expect(getUnmappedArchetypeDrops()).toHaveLength(1);
    resetUnmappedArchetypeDrops();
    expect(getUnmappedArchetypeDrops()).toEqual([]);
  });

  it("every mapped archetype still sums its weights to 1", () => {
    // The property the projection's fuzzy-membership semantics depend on.
    for (const [id, weights] of Object.entries(ARCHETYPE_BUCKET_MAP)) {
      const total = weights.reduce((s, w) => s + w.w, 0);
      expect(total, `${id} weights`).toBeCloseTo(1, 6);
    }
  });
});

function bucketsFor(cc: string): Set<string> {
  const model = getCountryLayer1Model(cc, eraForPreset("1953-default"))!;
  return new Set(
    model.dims.flatMap((d) => Object.keys(model.turnoutRates[d] ?? {}).map((k) => `${d}:${k}`))
  );
}
const ukBuckets = bucketsFor("UK");

describe("UK voter group coverage", () => {
  const UK_GROUPS = [
    "post_industrial_workers",
    "urban_progressives",
    "suburban_homeowners",
    "young_renters",
    "rural_traditionalists",
    "retirees",
    "public_sector",
    "moderate_centrists",
    "populist_right",
    "green_activists",
    "small_business",
    "new_britons",
  ];

  beforeEach(() => resetUnmappedArchetypeDrops());

  it("every UK voter group now projects onto real buckets", () => {
    // Previously seven of these mapped to nothing, so a UK Governor's Address
    // moved zero votes.
    for (const id of UK_GROUPS) {
      const out = archetypeValuesToBuckets({ [id]: 10 }, "UK");
      expect(Object.keys(out).length, `${id} projects nowhere`).toBeGreaterThan(0);
      // "Real" means real IN THE UK. The earlier mapping satisfied the check
      // above while naming US buckets the UK model does not have.
      for (const bucket of Object.keys(out)) {
        expect(ukBuckets.has(bucket), `${id} → ${bucket} is not a UK bucket`).toBe(true);
      }
    }
    expect(getUnmappedArchetypeDrops()).toEqual([]);
  });

  it("preserves the full magnitude of a targeted effect", () => {
    // Weights sum to 1, so the bucket values must sum back to the input.
    for (const id of UK_GROUPS) {
      const total = Object.values(archetypeValuesToBuckets({ [id]: 10 }, "UK")).reduce(
        (s, v) => s + v,
        0
      );
      expect(total, `${id} magnitude`).toBeCloseTo(10, 6);
    }
  });

  it("covers every JP and DE voter group too", () => {
    const JP = [
      "salaryman_conservative",
      "urban_progressive",
      "rural_traditionalist",
      "young_urban",
      "retiree",
      "public_sector",
      "small_business",
      "komeito_faithful",
      "reform_populist",
      "working_mothers",
    ];
    const DE = [
      "katholische_konservative",
      "gewerkschafter",
      "urbane_progressive",
      "wirtschaftsliberale",
      "ost_post_industriell",
      "gruene_mittelschicht",
      "rentner_west",
      "migranten_communities",
      "landwirte_dorf",
      "junge_grossstadt",
      "protest_waehler_ost",
      "mittelstand_selbstaendige",
    ];
    for (const [cc, ids] of [
      ["JP", JP],
      ["DE", DE],
    ] as const) {
      for (const id of ids) {
        const out = archetypeValuesToBuckets({ [id]: 10 }, cc);
        expect(Object.keys(out).length, `${cc} ${id} projects nowhere`).toBeGreaterThan(0);
        const total = Object.values(out).reduce((s, v) => s + v, 0);
        expect(total, `${cc} ${id} magnitude`).toBeCloseTo(10, 6);
        const real = bucketsFor(cc);
        for (const bucket of Object.keys(out)) {
          expect(real.has(bucket), `${cc} ${id} → ${bucket}`).toBe(true);
        }
      }
    }
    expect(getUnmappedArchetypeDrops()).toEqual([]);
  });

  it("leaves the US archetypes untouched", () => {
    // The UK additions must not have overwritten a US mapping.
    for (const id of ["evangelicals", "college_liberals", "soccer_moms"]) {
      expect(ARCHETYPE_BUCKET_MAP[id]).toBeDefined();
      const total = ARCHETYPE_BUCKET_MAP[id].reduce((s, w) => s + w.w, 0);
      expect(total).toBeCloseTo(1, 6);
    }
  });
});
