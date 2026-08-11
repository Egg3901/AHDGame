/**
 * Tests for the granular-cell electorate substrate (`granularElectorateEnabled`).
 *
 * Covers:
 *  - archetype→bucket mapping invariants (weights sum to 1, valid dims, 1-3 buckets)
 *  - substrate validity: unit shares form a distribution, pruning + renormalization
 *  - archetype-keyed approval / partyGroupFavorability remapping onto units
 *  - GOTV turnout modifiers folding into unit turnout (dim-keyed and archetype-keyed)
 *  - engine integration: valid share distribution + directional response to lean shifts
 *  - flag-OFF identity: the legacy archetype engine output is pinned (the flag-off
 *    code path does not touch the engines; this guards the engine itself)
 *  - perf smoke: substrate loop stays within budget of the archetype loop
 */

import { describe, it, expect, beforeEach } from "vitest";
import { getCountryLayer1Model } from "@/lib/seeds/international";
import { eraForPreset } from "@/lib/seeds/presetSelector";
// Side-effect import — populates stateCensusData with all US states so the
// Layer-1 derivation can find census configs.
import "@/lib/seeds/stateDemographics";
import type {
  DemographicCategory,
  Layer1PositionOverlay,
  Layer1TurnoutOverlay,
  StateDemographics,
  StateDemographicTurnout,
} from "@/lib/db/types";
import type { EnrichedCandidate } from "@/lib/electionEngine/types";
import { distributeVotesByGroupLevelAllocation } from "@/lib/electionEngine/voteDistribution";
import { GRANULAR_DIMENSIONS } from "@/lib/demographics/granularCells";
import {
  ARCHETYPE_BUCKET_MAP,
  archetypeValuesToBuckets,
} from "@/lib/demographics/archetypeBucketMap";
import {
  buildGranularElectorateSubstrate,
  deriveGranularElectorateUnits,
  remapArchetypeValuesToUnits,
  clearGranularElectorateCache,
  ELECTORATE_PRUNE_FLOOR,
  GRANULAR_CATEGORY_ID,
} from "@/lib/demographics/granularElectorate";

const ARCHETYPE_IDS = [
  "young_renters",
  "evangelicals",
  "rural_traditionalists",
  "union_trades",
  "soccer_moms",
  "college_liberals",
  "small_business",
  "public_sector",
  "retirees",
  "libertarians",
  "new_immigrants",
  "secular_professionals",
];

const LEGACY_CATEGORIES: DemographicCategory[] = [
  {
    _id: "voterGroups",
    name: "Voter Groups",
    defaultWeight: 100,
    groups: [
      {
        id: "college_liberals",
        name: "College Liberals",
        defaultEconomicLean: -4,
        defaultSocialLean: -3,
        defaultTurnout: 60,
      },
      {
        id: "rural_traditionalists",
        name: "Rural Traditionalists",
        defaultEconomicLean: 3,
        defaultSocialLean: 2,
        defaultTurnout: 70,
      },
      {
        id: "retirees",
        name: "Retirees",
        defaultEconomicLean: 1,
        defaultSocialLean: 2,
        defaultTurnout: 76,
      },
    ],
  },
];

const LEGACY_DEMOGRAPHICS: StateDemographics = {
  _id: "CT",
  countryId: "US",
  categoryWeights: { voterGroups: 100 },
  groups: {
    college_liberals: { population: 35, turnout: 60, economicLean: -4, socialLean: -3 },
    rural_traditionalists: { population: 35, turnout: 70, economicLean: 3, socialLean: 2 },
    retirees: { population: 30, turnout: 76, economicLean: 1, socialLean: 2 },
  },
  lastUpdated: new Date("2024-01-01"),
};

function makeCandidate(
  id: string,
  party: string,
  ep: number,
  sp: number,
  extra?: Partial<EnrichedCandidate>
): EnrichedCandidate {
  return {
    candidateId: id,
    characterId: `${id}_char`,
    characterName: id,
    party,
    isNPP: false,
    charEP: ep,
    charSP: sp,
    favorability: 55,
    politicalInfluence: 60,
    nationalInfluence: 50,
    ...extra,
  };
}

function buildSubstrate(overrides?: {
  turnoutDoc?: StateDemographicTurnout | null;
  enriched?: EnrichedCandidate[];
  partyGroupFavorabilityByKey?: Map<string, number>;
  stateId?: string;
}) {
  return buildGranularElectorateSubstrate({
    countryId: "US",
    stateId: overrides?.stateId ?? "CT",
    preset: "2019-default",
    turnoutDoc: overrides?.turnoutDoc ?? null,
    statePopulation: 1_000_000,
    demographics: LEGACY_DEMOGRAPHICS,
    categories: LEGACY_CATEGORIES,
    enriched: overrides?.enriched ?? [
      makeCandidate("left", "democrat", -2, -2),
      makeCandidate("right", "republican", 2, 2),
    ],
    partyGroupFavorabilityByKey: overrides?.partyGroupFavorabilityByKey,
  });
}

beforeEach(() => {
  clearGranularElectorateCache();
});

describe("ARCHETYPE_BUCKET_MAP", () => {
  it("covers all 12 archetypes with 1-3 buckets whose weights sum to 1", () => {
    const validDims = new Set<string>(GRANULAR_DIMENSIONS);
    for (const archetypeId of ARCHETYPE_IDS) {
      const weights = ARCHETYPE_BUCKET_MAP[archetypeId];
      expect(weights, archetypeId).toBeDefined();
      expect(weights.length).toBeGreaterThanOrEqual(1);
      expect(weights.length).toBeLessThanOrEqual(3);
      const sum = weights.reduce((s, w) => s + w.w, 0);
      expect(sum, `${archetypeId} weights must sum to 1`).toBeCloseTo(1, 10);
      for (const { dim, w } of weights) {
        expect(validDims.has(dim), `${archetypeId} dim ${dim}`).toBe(true);
        expect(w).toBeGreaterThan(0);
      }
    }
  });

  it("distributes archetype values onto buckets by weight", () => {
    const buckets = archetypeValuesToBuckets({ retirees: 40 });
    expect(buckets["age:senior"]).toBeCloseTo(28, 8);
    expect(buckets["age:mature"]).toBeCloseTo(12, 8);
    expect(Object.keys(buckets)).toHaveLength(2);
  });

  it("maps UK voter groups onto UK buckets when the country is given", () => {
    // Twice-corrected contract. It first asserted {} (the bug as the contract),
    // then asserted "projects somewhere" — which passed while projecting onto US
    // buckets the UK electorate does not have. The country is what makes it land.
    const buckets = archetypeValuesToBuckets({ urban_progressives: 25 }, "UK");
    expect(Object.keys(buckets).length).toBeGreaterThan(0);
    // Weights sum to 1, so the full magnitude survives the projection.
    expect(Object.values(buckets).reduce((s, v) => s + v, 0)).toBeCloseTo(25, 8);
    const model = getCountryLayer1Model("UK", eraForPreset("1953-default"))!;
    const real = new Set(
      model.dims.flatMap((d) => Object.keys(model.turnoutRates[d] ?? {}).map((k) => `${d}:${k}`))
    );
    for (const bucket of Object.keys(buckets)) expect(real.has(bucket), bucket).toBe(true);
  });

  it("drops a UK group asked for in the US vocabulary", () => {
    // The US table has no UK-only ids, and must not acquire any.
    expect(archetypeValuesToBuckets({ urban_progressives: 25 }, "US")).toEqual({});
  });

  it("still ignores a genuinely unknown id", () => {
    expect(archetypeValuesToBuckets({ not_a_real_group: 25 })).toEqual({});
  });
});

describe("deriveGranularElectorateUnits", () => {
  it("produces a pruned, renormalized distribution of units", () => {
    const derived = deriveGranularElectorateUnits("US", "CT", "2019-default", null);
    expect(derived).not.toBeNull();
    const { units } = derived!;
    expect(units.length).toBeGreaterThan(5);
    // Coalescing keeps the hot loop bounded: far fewer units than the raw
    // 5x4x3x3=180-cell cross product.
    expect(units.length).toBeLessThan(80);
    const shareSum = units.reduce((s, u) => s + u.share, 0);
    expect(shareSum).toBeCloseTo(1, 6);
    for (const u of units) {
      expect(Number.isFinite(u.share)).toBe(true);
      expect(u.share).toBeGreaterThanOrEqual(ELECTORATE_PRUNE_FLOOR);
      expect(u.economicLean).toBeGreaterThanOrEqual(-5);
      expect(u.economicLean).toBeLessThanOrEqual(5);
      expect(u.socialLean).toBeGreaterThanOrEqual(-5);
      expect(u.socialLean).toBeLessThanOrEqual(5);
      expect(u.turnout).toBeGreaterThanOrEqual(5);
      expect(u.turnout).toBeLessThanOrEqual(95);
      const bucketSum = Object.values(u.bucketWeights).reduce((s, v) => s + v, 0);
      // Each member cell contributes exactly one bucket per dimension.
      expect(bucketSum).toBeCloseTo(GRANULAR_DIMENSIONS.length, 6);
    }
  });

  it("returns null for states without a Layer-1 census", () => {
    expect(deriveGranularElectorateUnits("US", "NOT_A_STATE", "2019-default", null)).toBeNull();
  });

  it("derives era-correct units for the 1953 preset (validation branch target)", () => {
    const derived = deriveGranularElectorateUnits("US", "CT", "1953-default", null);
    expect(derived).not.toBeNull();
    const { units } = derived!;
    const shareSum = units.reduce((s, u) => s + u.share, 0);
    expect(shareSum).toBeCloseTo(1, 6);
    for (const u of units) {
      expect(Number.isFinite(u.economicLean)).toBe(true);
      expect(Number.isFinite(u.socialLean)).toBe(true);
      expect(u.turnout).toBeGreaterThanOrEqual(5);
      expect(u.turnout).toBeLessThanOrEqual(95);
    }
    // Different era census/positions should produce a different electorate
    // than the 2019 bundle (guard against a silent 2019 fallback).
    const modern = deriveGranularElectorateUnits("US", "CT", "2019-default", null)!;
    const sig = (us: typeof units) =>
      us.map((u) => `${u.share.toFixed(4)}|${u.economicLean.toFixed(2)}`).join(",");
    expect(sig(units)).not.toBe(sig(modern.units));
  });

  it("folds dim-keyed GOTV modifiers into unit turnout natively", () => {
    const doc: StateDemographicTurnout = {
      _id: "CT",
      countryId: "US",
      modifiers: { age: { senior: 15 } },
      lastDecayApplied: new Date(),
      lastUpdated: new Date(),
    };
    const base = deriveGranularElectorateUnits("US", "CT", "2019-default", null)!;
    const boosted = deriveGranularElectorateUnits("US", "CT", "2019-default", doc)!;
    const weightedTurnout = (units: typeof base.units, pick: (w: number) => boolean) => {
      const subset = units.filter((u) => pick(u.bucketWeights["age:senior"] ?? 0));
      const share = subset.reduce((s, u) => s + u.share, 0);
      return subset.reduce((s, u) => s + u.share * u.turnout, 0) / share;
    };
    // Senior-dominated units turn out more under the boost than without it.
    const baseSenior = weightedTurnout(base.units, (w) => w > 0.9);
    const boostedSenior = weightedTurnout(boosted.units, (w) => w > 0.9);
    expect(boostedSenior).toBeGreaterThan(baseSenior);
  });

  it("folds archetype-keyed GOTV modifiers via the bucket map", () => {
    const doc: StateDemographicTurnout = {
      _id: "CT",
      countryId: "US",
      modifiers: { voterGroups: { retirees: 15 } },
      lastDecayApplied: new Date(),
      lastUpdated: new Date(),
    };
    const base = deriveGranularElectorateUnits("US", "CT", "2019-default", null)!;
    const boosted = deriveGranularElectorateUnits("US", "CT", "2019-default", doc)!;
    const seniorTurnout = (units: typeof base.units) => {
      const subset = units.filter((u) => (u.bucketWeights["age:senior"] ?? 0) > 0.9);
      const share = subset.reduce((s, u) => s + u.share, 0);
      return subset.reduce((s, u) => s + u.share * u.turnout, 0) / share;
    };
    expect(seniorTurnout(boosted.units)).toBeGreaterThan(seniorTurnout(base.units));
  });
});

describe("layer1PositionOverrides — durable era-checkpoint base-value shift", () => {
  const weightedMean = (units: { share: number; economicLean: number; socialLean: number }[]) => {
    let w = 0;
    let e = 0;
    let s = 0;
    for (const u of units) {
      w += u.share;
      e += u.share * u.economicLean;
      s += u.share * u.socialLean;
    }
    return { economicLean: e / w, socialLean: s / w };
  };

  it("shifts the state's share-weighted mean lean and participates in the derivation cache key", () => {
    const overlay: Layer1PositionOverlay = {
      race: { white: { economicLean: 2, socialLean: 1.5 } },
    };
    const base = deriveGranularElectorateUnits("US", "CT", "2019-default", null)!;
    const shifted = deriveGranularElectorateUnits("US", "CT", "2019-default", null, overlay)!;

    const baseMean = weightedMean(base.units);
    const shiftedMean = weightedMean(shifted.units);
    // race:white is the dominant bucket in most states, so shifting its base
    // position measurably moves the whole electorate's mean lean rightward —
    // not just the cells that are purely race:white.
    expect(shiftedMean.economicLean).toBeGreaterThan(baseMean.economicLean);
    expect(shiftedMean.socialLean).toBeGreaterThan(baseMean.socialLean);

    // A structurally-different (but numerically inert) overlay is a distinct
    // cache entry that still reproduces the unshifted baseline — proves the
    // overlay participates in the memo key rather than being ignored after
    // the first derivation for this (country, state, preset).
    const inertOverlay: Layer1PositionOverlay = {
      race: { white: { economicLean: 0, socialLean: 0 } },
    };
    const inert = deriveGranularElectorateUnits("US", "CT", "2019-default", null, inertOverlay)!;
    expect(weightedMean(inert.units).economicLean).toBeCloseTo(baseMean.economicLean, 6);
  });

  it("is additive per-bucket: doubling the delta roughly doubles the shift", () => {
    // Approximately linear, not exactly: `deriveGranularCellsGeneric` rounds
    // cell leans to 1 decimal and `coalesceCells` quantizes onto LEAN_QUANT
    // bins before averaging, so a doubled per-bucket input can land member
    // cells in different coalesced units than the single-delta run. The
    // per-bucket contribution to each cell's OWN lean (before quantization)
    // is exactly linear (see `applyPositionOverlay`); this checks that
    // survives coalescing within a loose tolerance.
    const base = deriveGranularElectorateUnits("US", "CT", "2019-default", null)!;
    const single = deriveGranularElectorateUnits("US", "CT", "2019-default", null, {
      age: { senior: { economicLean: 1, socialLean: 0 } },
    })!;
    const double = deriveGranularElectorateUnits("US", "CT", "2019-default", null, {
      age: { senior: { economicLean: 2, socialLean: 0 } },
    })!;
    const baseMean = weightedMean(base.units).economicLean;
    const singleDelta = weightedMean(single.units).economicLean - baseMean;
    const doubleDelta = weightedMean(double.units).economicLean - baseMean;
    expect(singleDelta).toBeGreaterThan(0);
    expect(doubleDelta / singleDelta).toBeGreaterThan(1.7);
    expect(doubleDelta / singleDelta).toBeLessThan(2.3);
  });

  it("does nothing for a country whose Layer-1 model has no matching dimension", () => {
    // Non-US models only have the dims the CountryLayer1Model declares;
    // an overlay dim the model doesn't recognize is silently inert rather
    // than throwing.
    const overlay: Layer1PositionOverlay = {
      not_a_real_dimension: { some_key: { economicLean: 5, socialLean: 5 } },
    };
    const base = deriveGranularElectorateUnits("US", "CT", "2019-default", null)!;
    const withBogusOverlay = deriveGranularElectorateUnits(
      "US",
      "CT",
      "2019-default",
      null,
      overlay
    )!;
    expect(weightedMean(withBogusOverlay.units)).toEqual(weightedMean(base.units));
  });

  it("flows into buildGranularElectorateSubstrate via demographicDefaults.layer1PositionOverrides", () => {
    const overlay: Layer1PositionOverlay = {
      age: { senior: { economicLean: 3, socialLean: 0 } },
    };
    const defaultsWithOverlay: StateDemographics = {
      ...LEGACY_DEMOGRAPHICS,
      layer1PositionOverrides: overlay,
    };
    const base = buildSubstrate()!;
    const withOverlay = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "CT",
      preset: "2019-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: LEGACY_DEMOGRAPHICS,
      categories: LEGACY_CATEGORIES,
      enriched: [],
      demographicDefaults: defaultsWithOverlay,
    })!;

    // Bucket-weighted mean over senior-carrying units only (robust to unit
    // repartitioning across the two derivations — see the GOTV-modifier test
    // above for the same pattern).
    const seniorWeightedEcon = (units: typeof base.units) => {
      let w = 0;
      let e = 0;
      for (const u of units) {
        const bw = u.bucketWeights["age:senior"] ?? 0;
        if (bw <= 0) continue;
        w += u.share * bw;
        e += u.share * bw * u.economicLean;
      }
      return e / w;
    };
    expect(seniorWeightedEcon(withOverlay.units)).toBeGreaterThan(seniorWeightedEcon(base.units));
  });
});

describe("layer1TurnoutOverrides — durable turnout shift (the Voting Rights Act's channel)", () => {
  const weightedTurnoutFor = (
    units: { share: number; turnout: number; bucketWeights: Record<string, number> }[],
    bucketKey: string
  ) => {
    let w = 0;
    let t = 0;
    for (const u of units) {
      const bw = u.bucketWeights[bucketKey] ?? 0;
      if (bw <= 0) continue;
      w += u.share * bw;
      t += u.share * bw * u.turnout;
    }
    return t / w;
  };

  it("raises the bucket's own turnout rate before cell derivation, not just the derived unit", () => {
    const overlay: Layer1TurnoutOverlay = { race: { black: 20 } };
    const base = deriveGranularElectorateUnits("US", "AL", "1953-default", null)!;
    const shifted = deriveGranularElectorateUnits(
      "US",
      "AL",
      "1953-default",
      null,
      undefined,
      overlay
    )!;

    const baseTurnout = weightedTurnoutFor(base.units, "race:black");
    const shiftedTurnout = weightedTurnoutFor(shifted.units, "race:black");
    expect(shiftedTurnout).toBeGreaterThan(baseTurnout);

    // A structurally-different but numerically inert overlay is a distinct
    // cache entry that still reproduces the unshifted baseline — proves the
    // overlay participates in the unit-cache memo key (see
    // `deriveGranularElectorateUnits`'s doc comment) rather than being
    // ignored after the first derivation for this (country, state, preset).
    const inert: Layer1TurnoutOverlay = { race: { black: 0 } };
    const inertDerived = deriveGranularElectorateUnits(
      "US",
      "AL",
      "1953-default",
      null,
      undefined,
      inert
    )!;
    expect(weightedTurnoutFor(inertDerived.units, "race:black")).toBeCloseTo(baseTurnout, 6);
  });

  it("moves the targeted bucket far more than any other bucket (cross-bucket leakage is only from the shared renormalization step, not a bug in the overlay itself)", () => {
    // `deriveGranularCells` renormalizes every cell's turnout so the
    // population-weighted mean matches a fixed marginal baseline (see its
    // module doc) — boosting ONE bucket therefore nudges every OTHER
    // bucket's turnout slightly too (a documented, pre-existing property of
    // the turnout model, not something this overlay introduces). The
    // targeted bucket's OWN move must still dominate by a wide margin.
    const overlay: Layer1TurnoutOverlay = { race: { black: 20 } };
    const base = deriveGranularElectorateUnits("US", "AL", "1953-default", null)!;
    const shifted = deriveGranularElectorateUnits(
      "US",
      "AL",
      "1953-default",
      null,
      undefined,
      overlay
    )!;
    const blackDelta =
      weightedTurnoutFor(shifted.units, "race:black") -
      weightedTurnoutFor(base.units, "race:black");
    const whiteDelta =
      weightedTurnoutFor(shifted.units, "race:white") -
      weightedTurnoutFor(base.units, "race:white");
    expect(blackDelta).toBeGreaterThan(0);
    expect(Math.abs(blackDelta)).toBeGreaterThan(Math.abs(whiteDelta) * 3);
  });

  it("a sustained NEGATIVE (suppression) delta lowers the bucket's turnout — beatable in both directions", () => {
    const suppressed: Layer1TurnoutOverlay = { race: { black: -20 } };
    const base = deriveGranularElectorateUnits("US", "AL", "1953-default", null)!;
    const shifted = deriveGranularElectorateUnits(
      "US",
      "AL",
      "1953-default",
      null,
      undefined,
      suppressed
    )!;
    expect(weightedTurnoutFor(shifted.units, "race:black")).toBeLessThan(
      weightedTurnoutFor(base.units, "race:black")
    );
  });

  it("does nothing for a country whose Layer-1 model has no matching dimension", () => {
    const overlay: Layer1TurnoutOverlay = { not_a_real_dimension: { some_key: 30 } };
    const base = deriveGranularElectorateUnits("US", "AL", "1953-default", null)!;
    const withBogusOverlay = deriveGranularElectorateUnits(
      "US",
      "AL",
      "1953-default",
      null,
      undefined,
      overlay
    )!;
    expect(weightedTurnoutFor(withBogusOverlay.units, "race:black")).toBeCloseTo(
      weightedTurnoutFor(base.units, "race:black"),
      6
    );
  });

  it("flows into buildGranularElectorateSubstrate via demographicDefaults.layer1TurnoutOverrides", () => {
    const overlay: Layer1TurnoutOverlay = { race: { black: 25 } };
    const defaultsWithOverlay: StateDemographics = {
      ...LEGACY_DEMOGRAPHICS,
      _id: "AL",
      layer1TurnoutOverrides: overlay,
    };
    const base = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "AL",
      preset: "1953-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: { ...LEGACY_DEMOGRAPHICS, _id: "AL" },
      categories: LEGACY_CATEGORIES,
      enriched: [],
    })!;
    const withOverlay = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "AL",
      preset: "1953-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: { ...LEGACY_DEMOGRAPHICS, _id: "AL" },
      categories: LEGACY_CATEGORIES,
      enriched: [],
      demographicDefaults: defaultsWithOverlay,
    })!;

    expect(weightedTurnoutFor(withOverlay.units, "race:black")).toBeGreaterThan(
      weightedTurnoutFor(base.units, "race:black")
    );
  });

  it("VOTE OUTPUT: raising a bucket's turnout raises the vote share of a candidate specifically aligned with that bucket", () => {
    // Determine the race:black bucket's own (pre-shift) weighted-mean lean —
    // dynamically, not hard-coded, so this test does not assume a particular
    // real-world political direction — then place one candidate exactly
    // there (`mover`, so it is uniquely the best-aligned option for that
    // bucket specifically, not just the state's overall electorate) and
    // another candidate at the state's OVERALL weighted mean (`anchor`, a
    // generic "appeals to everyone equally" candidate). Same technique the
    // "responds directionally" test above uses to isolate a signal.
    const pristine = deriveGranularElectorateUnits("US", "CT", "2019-default", null)!;
    const meanOf = (pick: (u: (typeof pristine.units)[number]) => number) => {
      let w = 0;
      let e = 0;
      let s = 0;
      for (const u of pristine.units) {
        const weight = pick(u);
        if (weight <= 0) continue;
        w += u.share * weight;
        e += u.share * weight * u.economicLean;
        s += u.share * weight * u.socialLean;
      }
      return { economicLean: e / w, socialLean: s / w };
    };
    const blackMean = meanOf((u) => u.bucketWeights["race:black"] ?? 0);
    const overallMean = meanOf(() => 1);

    const enriched = [
      makeCandidate("mover", "democrat", blackMean.economicLean, blackMean.socialLean),
      makeCandidate("anchor", "republican", overallMean.economicLean, overallMean.socialLean),
    ];
    const baseline = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "CT",
      preset: "2019-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: LEGACY_DEMOGRAPHICS,
      categories: LEGACY_CATEGORIES,
      enriched,
    })!;

    const overlay: Layer1TurnoutOverlay = { race: { black: 40 } };
    const boosted = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "CT",
      preset: "2019-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: LEGACY_DEMOGRAPHICS,
      categories: LEGACY_CATEGORIES,
      enriched,
      demographicDefaults: { ...LEGACY_DEMOGRAPHICS, layer1TurnoutOverrides: overlay },
    })!;

    // Unrounded share: sharesPct quantizes to 0.1pp, which can swallow a
    // small-bucket shift (race:black is ~10% of CT), so compare raw votes.
    const shares = (s: NonNullable<ReturnType<typeof buildGranularElectorateSubstrate>>) => {
      const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
        s.enriched,
        s.totalPool,
        s.totalPool,
        1_000_000,
        s.demographics,
        s.categories,
        new Map(),
        { isGeneralElection: true, countryId: "US", liveTurnouts: s.liveTurnouts }
      );
      const total = Object.values(votesPerCandidate).reduce((a, b) => a + b, 0);
      return votesPerCandidate["mover"] / total;
    };

    const baselineShare = shares(baseline);
    const boostedShare = shares(boosted);
    // A stored field moving is not enough — this is the actual vote output:
    // weighting the electorate more heavily toward race:black cells raises
    // the share of the candidate best-aligned with THAT bucket specifically.
    expect(boostedShare).toBeGreaterThan(baselineShare);
  });
});

describe("buildGranularElectorateSubstrate", () => {
  it("produces engine-shaped demographics/categories/liveTurnouts", () => {
    const substrate = buildSubstrate();
    expect(substrate).not.toBeNull();
    const { demographics, categories, liveTurnouts, totalPool, units } = substrate!;
    expect(categories).toHaveLength(1);
    expect(categories[0]._id).toBe(GRANULAR_CATEGORY_ID);
    expect(demographics.categoryWeights[GRANULAR_CATEGORY_ID]).toBe(100);
    expect(Object.keys(demographics.groups)).toHaveLength(units.length);
    const popSum = Object.values(demographics.groups).reduce((s, g) => s + g.population, 0);
    expect(popSum).toBeCloseTo(100, 4);
    for (const unit of units) {
      expect(liveTurnouts[unit.id]).toBeDefined();
      expect(demographics.groups[unit.id]).toBeDefined();
    }
    expect(totalPool).toBeGreaterThan(0);
    expect(totalPool).toBeLessThan(1_000_000);
  });

  it("returns null (legacy fallback) when the state has no census", () => {
    expect(buildSubstrate({ stateId: "NOT_A_STATE" })).toBeNull();
  });

  it("remaps candidate archetypeApprovals onto units", () => {
    const substrate = buildSubstrate({
      enriched: [makeCandidate("cand", "democrat", 0, 0, { archetypeApprovals: { retirees: 40 } })],
    })!;
    const approvals = substrate.enriched[0].archetypeApprovals!;
    const values = Object.values(approvals);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(100);
    }
    // A pure-senior unit picks up the full senior bucket value (0.7 x 40 = 28).
    const pureSenior = substrate.units.find((u) => (u.bucketWeights["age:senior"] ?? 0) > 0.99);
    if (pureSenior) {
      expect(approvals[pureSenior.id]).toBeCloseTo(28, 1);
    }
    // Units with no senior/mature membership receive nothing.
    const unrelated = substrate.units.find(
      (u) =>
        (u.bucketWeights["age:senior"] ?? 0) === 0 && (u.bucketWeights["age:mature"] ?? 0) === 0
    );
    if (unrelated) {
      expect(approvals[unrelated.id]).toBeUndefined();
    }
  });

  it("remaps partyGroupFavorability keys onto units", () => {
    const substrate = buildSubstrate({
      partyGroupFavorabilityByKey: new Map([["democrat:retirees", 10]]),
    })!;
    const remapped = substrate.partyGroupFavorabilityByKey!;
    expect(remapped.size).toBeGreaterThan(0);
    for (const [key, v] of remapped) {
      expect(key.startsWith("democrat:gcell_")).toBe(true);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("folds legislation-driven lean drift (live vs seeded defaults) onto unit leans", () => {
    // Seeded snapshot: retirees at economicLean 1. Live doc: drifted to 3
    // (+2 economic drift from legislation). Senior-heavy units must shift
    // right relative to a substrate built without the defaults doc.
    const defaults: StateDemographics = {
      ...LEGACY_DEMOGRAPHICS,
      groups: {
        ...LEGACY_DEMOGRAPHICS.groups,
        retirees: { ...LEGACY_DEMOGRAPHICS.groups.retirees, economicLean: 1 },
      },
    };
    const live: StateDemographics = {
      ...LEGACY_DEMOGRAPHICS,
      groups: {
        ...LEGACY_DEMOGRAPHICS.groups,
        retirees: { ...LEGACY_DEMOGRAPHICS.groups.retirees, economicLean: 3 },
      },
    };
    const base = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "CT",
      preset: "2019-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: live,
      categories: LEGACY_CATEGORIES,
      enriched: [],
    })!;
    const folded = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "CT",
      preset: "2019-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: live,
      categories: LEGACY_CATEGORIES,
      enriched: [],
      demographicDefaults: defaults,
    })!;
    // Pure-senior unit: full drift (+2 x 0.7 senior weight = +1.4).
    const seniorUnit = folded.units.find((u) => (u.bucketWeights["age:senior"] ?? 0) > 0.99);
    expect(seniorUnit).toBeDefined();
    const baseLean = base.demographics.groups[seniorUnit!.id].economicLean;
    const foldedLean = folded.demographics.groups[seniorUnit!.id].economicLean;
    expect(foldedLean - baseLean).toBeCloseTo(1.4, 6);
    // Units with no senior/mature membership are untouched.
    const unrelated = folded.units.find(
      (u) =>
        (u.bucketWeights["age:senior"] ?? 0) === 0 && (u.bucketWeights["age:mature"] ?? 0) === 0
    );
    if (unrelated) {
      expect(folded.demographics.groups[unrelated.id].economicLean).toBeCloseTo(
        base.demographics.groups[unrelated.id].economicLean,
        8
      );
    }
    // No drift when live matches the seeded snapshot.
    const identical = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "CT",
      preset: "2019-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: live,
      categories: LEGACY_CATEGORIES,
      enriched: [],
      demographicDefaults: live,
    })!;
    for (const u of identical.units) {
      expect(identical.demographics.groups[u.id].economicLean).toBeCloseTo(
        base.demographics.groups[u.id].economicLean,
        8
      );
    }
  });

  it("remap is linear and exact for coalesced units", () => {
    const { units } = deriveGranularElectorateUnits("US", "CT", "2019-default", null)!;
    const a = remapArchetypeValuesToUnits({ retirees: 20 }, units);
    const b = remapArchetypeValuesToUnits({ retirees: 40 }, units);
    for (const [unitId, v] of Object.entries(a)) {
      expect(b[unitId]).toBeCloseTo(v * 2, 8);
    }
  });
});

describe("granular substrate through the vote engine", () => {
  const run = (
    enriched: EnrichedCandidate[],
    substrate: NonNullable<ReturnType<typeof buildSubstrate>>
  ) =>
    distributeVotesByGroupLevelAllocation(
      enriched,
      substrate.totalPool,
      substrate.totalPool,
      1_000_000,
      substrate.demographics,
      substrate.categories,
      new Map(),
      {
        isGeneralElection: true,
        countryId: "US",
        liveTurnouts: substrate.liveTurnouts,
        partyGroupFavorabilityByKey: substrate.partyGroupFavorabilityByKey,
      }
    );

  it("produces a valid share distribution (sums to 100, no NaN/negatives)", () => {
    const enriched = [
      makeCandidate("left", "democrat", -2, -2),
      makeCandidate("right", "republican", 2, 2),
    ];
    const substrate = buildSubstrate({ enriched })!;
    const { votesPerCandidate, sharesPct } = run(substrate.enriched, substrate);
    const shareSum = Object.values(sharesPct).reduce((s, v) => s + v, 0);
    expect(shareSum).toBeGreaterThan(99);
    expect(shareSum).toBeLessThan(101);
    for (const v of Object.values(votesPerCandidate)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    const totalVotes = Object.values(votesPerCandidate).reduce((s, v) => s + v, 0);
    expect(totalVotes).toBeGreaterThan(0);
  });

  it("responds directionally: moving a candidate toward the electorate lean raises share", () => {
    const substrate = buildSubstrate()!;
    // Share-and-turnout-weighted mean lean of the cell electorate.
    let w = 0;
    let ep = 0;
    let sp = 0;
    for (const u of substrate.units) {
      const uw = u.share * u.turnout;
      w += uw;
      ep += uw * u.economicLean;
      sp += uw * u.socialLean;
    }
    const meanEP = ep / w;
    const meanSP = sp / w;

    const away = [
      makeCandidate("mover", "democrat", meanEP + 3, Math.min(5, meanSP + 3)),
      makeCandidate("anchor", "republican", meanEP + 1.5, meanSP + 1.5),
    ];
    const toward = [
      makeCandidate("mover", "democrat", meanEP, meanSP),
      makeCandidate("anchor", "republican", meanEP + 1.5, meanSP + 1.5),
    ];
    const awayShares = run(away, substrate).sharesPct;
    const towardShares = run(toward, substrate).sharesPct;
    expect(towardShares["mover"]).toBeGreaterThan(awayShares["mover"]);
  });

  it("archetype-keyed approvals shift cell-engine results in the right direction", () => {
    const neutral = buildSubstrate({
      enriched: [makeCandidate("a", "democrat", 0, 0), makeCandidate("b", "republican", 0, 0)],
    })!;
    const boosted = buildSubstrate({
      enriched: [
        makeCandidate("a", "democrat", 0, 0, { archetypeApprovals: { retirees: 60 } }),
        makeCandidate("b", "republican", 0, 0),
      ],
    })!;
    const neutralShares = run(neutral.enriched, neutral).sharesPct;
    const boostedShares = run(boosted.enriched, boosted).sharesPct;
    expect(boostedShares["a"]).toBeGreaterThan(neutralShares["a"]);
  });

  it("stays within the perf budget vs the archetype engine (soft bound)", () => {
    const enriched = [
      makeCandidate("left", "democrat", -2, -2),
      makeCandidate("right", "republican", 2, 2),
      makeCandidate("third", "libertarian_party", 4, 1),
    ];
    const substrate = buildSubstrate({ enriched })!;
    const iterations = 300;

    // Realistic legacy electorate: the production archetype substrate has 12
    // mutually-exclusive groups, not the 3-group unit fixture above.
    const twelveGroups: DemographicCategory[] = [
      {
        _id: "voterGroups",
        name: "Voter Groups",
        defaultWeight: 100,
        groups: ARCHETYPE_IDS.map((id, i) => ({
          id,
          name: id,
          defaultEconomicLean: ((i % 11) - 5) * 0.8,
          defaultSocialLean: (((i + 4) % 11) - 5) * 0.8,
          defaultTurnout: 45 + (i % 5) * 8,
        })),
      },
    ];
    const twelveDemographics: StateDemographics = {
      _id: "CT",
      countryId: "US",
      categoryWeights: { voterGroups: 100 },
      groups: Object.fromEntries(
        ARCHETYPE_IDS.map((id, i) => [
          id,
          {
            population: 100 / ARCHETYPE_IDS.length,
            turnout: 45 + (i % 5) * 8,
            economicLean: ((i % 11) - 5) * 0.8,
            socialLean: (((i + 4) % 11) - 5) * 0.8,
          },
        ])
      ),
      lastUpdated: new Date("2024-01-01"),
    };

    const legacyRun = () =>
      distributeVotesByGroupLevelAllocation(
        enriched,
        500_000,
        500_000,
        1_000_000,
        twelveDemographics,
        twelveGroups,
        new Map(),
        { isGeneralElection: true, countryId: "US" }
      );
    const granularRun = () => run(substrate.enriched, substrate);

    // Warmup for JIT fairness.
    for (let i = 0; i < 50; i++) {
      legacyRun();
      granularRun();
    }
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) legacyRun();
    const legacyMs = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < iterations; i++) granularRun();
    const granularMs = performance.now() - t1;

    const ratio = granularMs / Math.max(legacyMs, 0.001);
    // Design target is ~4x; the CI bound is deliberately loose (10x) so timer
    // noise doesn't flake, while still catching an accidental O(cells^2) blowup.
    console.log(
      `[granularElectorate perf] legacy=${legacyMs.toFixed(1)}ms granular=${granularMs.toFixed(1)}ms ratio=${ratio.toFixed(2)}x units=${substrate.units.length}`
    );
    expect(ratio).toBeLessThan(10);
  });
});

describe("flag OFF — legacy engine untouched", () => {
  it("legacy archetype engine output is pinned (regression lock)", () => {
    const enriched = [
      makeCandidate("left", "democrat", -2, -2),
      makeCandidate("right", "republican", 2, 2),
    ];
    const { sharesPct } = distributeVotesByGroupLevelAllocation(
      enriched,
      500_000,
      500_000,
      1_000_000,
      LEGACY_DEMOGRAPHICS,
      LEGACY_CATEGORIES,
      new Map(),
      { isGeneralElection: true, countryId: "US" }
    );
    // Pinned from the legacy engine BEFORE the granular-electorate change; the
    // flag-off path must keep producing exactly these shares.
    expect(sharesPct).toMatchInlineSnapshot(`
      {
        "left": 35.8,
        "right": 64.2,
      }
    `);
  });
});
