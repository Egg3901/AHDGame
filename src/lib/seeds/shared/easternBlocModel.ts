import type { CountryLayer1Model } from "@/lib/seeds/international/types";
import type { EraId } from "@/lib/seeds/presetSelector";
import type { DemographicCategory } from "@/lib/db/types";

/**
 * Shared Layer-1 model + demographic-category builders for the Warsaw-Pact
 * one-party states. Six standard command-economy archetypes; the country's own
 * census (and titular-ethnicity keys) drive the per-region outcome. Leans run:
 *   economicLean -5 (plan/socialist) … +5 (market/reform)
 *   socialLean   -5 (secular/liberal) … +5 (traditional)
 *
 * Two authored eras: **1953** (high-Stalinist, pre-collectivisation in much of
 * the bloc, the church still a mass institution) and **1979** (mature, settled
 * "goulash"/consumer socialism). The 1953 table is NOT derived from 1979 — it
 * is authored directly, mirroring the RU/DD models' era split.
 */

export const EASTERN_BLOC_GROUP_IDS = [
  "party_nomenklatura",
  "industrial_worker",
  "collective_farmer",
  "intelligentsia",
  "religious_traditional",
  "youth",
] as const;

const GROUP_NAMES: Record<string, string> = {
  party_nomenklatura: "Party Nomenklatura",
  industrial_worker: "Industrial Worker",
  collective_farmer: "Collective Farmer",
  intelligentsia: "Technical Intelligentsia",
  religious_traditional: "Religious / Traditional",
  youth: "Youth",
};

const DEFAULT_LEANS = {
  party_nomenklatura: { economicLean: -3, socialLean: 2 },
  industrial_worker: { economicLean: -3, socialLean: 0 },
  collective_farmer: { economicLean: -2, socialLean: 2 },
  intelligentsia: { economicLean: 0, socialLean: -2 },
  religious_traditional: { economicLean: -1, socialLean: 3 },
  youth: { economicLean: -1, socialLean: -1 },
} as const;

const COMPOSITION = {
  party_nomenklatura: {
    weights: [
      { dim: "income", key: "high", w: 0.4 },
      { dim: "education", key: "university", w: 0.3 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mature", w: 0.1 },
    ],
    civicMultiplier: 1.1,
  },
  industrial_worker: {
    weights: [
      { dim: "income", key: "low", w: 0.35 },
      { dim: "education", key: "vocational", w: 0.35 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mid", w: 0.1 },
    ],
    civicMultiplier: 1.0,
  },
  collective_farmer: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.55 },
      { dim: "income", key: "low", w: 0.25 },
      { dim: "age", key: "mature", w: 0.2 },
    ],
    civicMultiplier: 1.0,
  },
  intelligentsia: {
    weights: [
      { dim: "education", key: "university", w: 0.5 },
      { dim: "income", key: "middle", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.25 },
    ],
    civicMultiplier: 1.0,
  },
  religious_traditional: {
    weights: [
      { dim: "age", key: "senior", w: 0.4 },
      { dim: "urbanization", key: "rural", w: 0.3 },
      { dim: "education", key: "primary_or_below", w: 0.3 },
    ],
    civicMultiplier: 0.95,
  },
  youth: {
    weights: [
      { dim: "age", key: "young", w: 0.6 },
      { dim: "education", key: "vocational", w: 0.2 },
      { dim: "urbanization", key: "urban", w: 0.2 },
    ],
    civicMultiplier: 0.9,
  },
} as const;

type DimPositions = Record<string, { economicLean: number; socialLean: number }>;

// ── 1979: mature consumer socialism ─────────────────────────────────────────
// The plan is settled and unquestioned; differences between cohorts are mild.
const AGE_POS_1979: DimPositions = {
  young: { economicLean: -1.5, socialLean: -1.0 },
  mid: { economicLean: -1.0, socialLean: 0.0 },
  mature: { economicLean: -0.5, socialLean: 1.0 },
  senior: { economicLean: 0.0, socialLean: 2.0 },
};
const EDU_POS_1979: DimPositions = {
  primary_or_below: { economicLean: -1.0, socialLean: 1.5 },
  secondary: { economicLean: -1.0, socialLean: 0.5 },
  vocational: { economicLean: -1.0, socialLean: 0.0 },
  university: { economicLean: 0.5, socialLean: -1.0 },
};
const INC_POS_1979: DimPositions = {
  low: { economicLean: -2.0, socialLean: 0.5 },
  middle: { economicLean: -1.0, socialLean: 0.5 },
  high: { economicLean: 1.5, socialLean: 0.5 },
};
const URB_POS_1979: DimPositions = {
  urban: { economicLean: -0.5, socialLean: -0.5 },
  suburban: { economicLean: -0.5, socialLean: 0.5 },
  rural: { economicLean: -0.5, socialLean: 1.5 },
};

// ── 1953: high Stalinism ────────────────────────────────────────────────────
// Authored for the early bloc, not scaled from 1979. Three real differences:
//  - Collectivisation is INCOMPLETE almost everywhere (Poland's private peasant
//    farms survive to 1989; Hungary's first collectivisation drive collapses in
//    1956; Yugoslavia abandons its in 1953). The countryside is therefore the
//    most market-minded and most traditional bloc in the country, not a
//    uniformly statist one — so `rural` carries a real positive economic lean
//    where 1979 flattened all three urbanization buckets to -0.5.
//  - The church is still a mass institution (the Polish primate Wyszyński is
//    interned in September 1953), so the low-education / senior / rural milieux
//    are markedly more traditional than their 1979 successors.
//  - The intelligentsia is under active purge and the private artisan and
//    professional remnant has not yet been expropriated, so the university and
//    high-income buckets pull much harder toward reform/market.
// Net effect: a wider spread on BOTH axes than 1979, which is what makes the
// regions politically distinguishable in a 1953 world.
const AGE_POS_1953: DimPositions = {
  young: { economicLean: -1.8, socialLean: -1.4 }, // new communist youth leagues
  mid: { economicLean: -1.0, socialLean: 0.4 },
  mature: { economicLean: 0.4, socialLean: 1.8 },
  senior: { economicLean: 1.6, socialLean: 3.2 }, // pre-war generation, market memory
};
const EDU_POS_1953: DimPositions = {
  primary_or_below: { economicLean: -1.4, socialLean: 2.4 }, // village parish milieu
  secondary: { economicLean: -0.8, socialLean: 0.8 },
  vocational: { economicLean: -1.2, socialLean: -0.2 }, // the regime's core cadre
  university: { economicLean: 2.2, socialLean: -1.6 }, // purged intelligentsia
};
const INC_POS_1953: DimPositions = {
  low: { economicLean: -2.4, socialLean: 1.0 },
  middle: { economicLean: -0.8, socialLean: 0.8 },
  high: { economicLean: 3.2, socialLean: 0.8 }, // surviving private artisans/professionals
};
const URB_POS_1953: DimPositions = {
  urban: { economicLean: -1.8, socialLean: -1.4 }, // new industrial towns, plan strongholds
  suburban: { economicLean: -0.4, socialLean: 0.8 },
  rural: { economicLean: 1.8, socialLean: 3.0 }, // uncollectivised peasantry, church
};

interface EraModelProfile {
  age: DimPositions;
  education: DimPositions;
  income: DimPositions;
  urbanization: DimPositions;
  /** Titular / minority ethnicity positions. */
  titular: { economicLean: number; socialLean: number };
  minority: { economicLean: number; socialLean: number };
  turnoutRates: CountryLayer1Model["turnoutRates"];
  titularTurnout: number;
  minorityTurnout: number;
}

const ERA_PROFILES: Record<"1953" | "1979", EraModelProfile> = {
  // Mobilised, terror-backed near-unanimity: the 1952-54 bloc elections reported
  // 99%+ turnout on single lists, and abstention was itself a political act.
  "1953": {
    age: AGE_POS_1953,
    education: EDU_POS_1953,
    income: INC_POS_1953,
    urbanization: URB_POS_1953,
    titular: { economicLean: -0.8, socialLean: 1.6 },
    minority: { economicLean: -1.0, socialLean: 0.8 },
    turnoutRates: {
      ethnicity: {},
      age: { young: 96, mid: 98, mature: 98, senior: 96 },
      education: { primary_or_below: 98, secondary: 97, vocational: 98, university: 96 },
      income: { low: 98, middle: 97, high: 95 },
      urbanization: { urban: 98, suburban: 97, rural: 96 },
    },
    titularTurnout: 98,
    minorityTurnout: 92,
  },
  "1979": {
    age: AGE_POS_1979,
    education: EDU_POS_1979,
    income: INC_POS_1979,
    urbanization: URB_POS_1979,
    titular: { economicLean: -1.0, socialLean: 1.0 },
    minority: { economicLean: -1.2, socialLean: 0.3 },
    turnoutRates: {
      ethnicity: {},
      age: { young: 90, mid: 95, mature: 96, senior: 94 },
      education: { primary_or_below: 94, secondary: 95, vocational: 95, university: 96 },
      income: { low: 94, middle: 95, high: 96 },
      urbanization: { urban: 95, suburban: 95, rural: 94 },
    },
    titularTurnout: 95,
    minorityTurnout: 82,
  },
};

/** The bloc only exists in the Cold-War eras; anything else reads as 1979. */
export function easternBlocEraKey(era: EraId): "1953" | "1979" {
  return era === "1953" ? "1953" : "1979";
}

type Census = Record<string, Record<string, Record<string, number>>>;

/**
 * Build a planned-economy Layer-1 model for an era. `ethnicityKeys[0]` is
 * treated as the titular majority (slightly more traditional); the rest are
 * minorities. `era` selects the 1953 or 1979 position/turnout table; callers
 * pass the matching era census.
 */
export function makeEasternBlocModel(
  countryId: string,
  categoryId: string,
  ethnicityKeys: string[],
  census: Census,
  era: EraId = "1979"
): CountryLayer1Model {
  const profile = ERA_PROFILES[easternBlocEraKey(era)];
  const ethPos: Record<string, { economicLean: number; socialLean: number }> = {};
  const ethTurnout: Record<string, number> = {};
  ethnicityKeys.forEach((k, i) => {
    ethPos[k] = i === 0 ? { ...profile.titular } : { ...profile.minority };
    ethTurnout[k] = i === 0 ? profile.titularTurnout : profile.minorityTurnout;
  });
  return {
    countryId,
    categoryId,
    groupIds: [...EASTERN_BLOC_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: {
      ...profile.turnoutRates,
      ethnicity: ethTurnout,
    },
    positions: {
      ethnicity: ethPos,
      age: profile.age,
      education: profile.education,
      income: profile.income,
      urbanization: profile.urbanization,
    },
    composition: COMPOSITION as unknown as CountryLayer1Model["composition"],
    defaultLeans: DEFAULT_LEANS as unknown as CountryLayer1Model["defaultLeans"],
    census,
  };
}

/** Build the matching demographic-category doc for the standard 6 archetypes. */
export function makeEasternBlocCategories(categoryId: string, name: string): DemographicCategory[] {
  return [
    {
      _id: categoryId,
      name,
      defaultWeight: 100,
      groups: EASTERN_BLOC_GROUP_IDS.map((id) => ({
        id,
        name: GROUP_NAMES[id],
        defaultEconomicLean: DEFAULT_LEANS[id].economicLean,
        defaultSocialLean: DEFAULT_LEANS[id].socialLean,
        defaultTurnout: 94,
      })),
    },
  ];
}
