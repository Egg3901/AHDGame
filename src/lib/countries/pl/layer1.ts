import type { CountryLayer1Model, DemographicPosition } from "@/lib/seeds/international/types";
import type { EraId } from "@/lib/seeds/presetSelector";
import { easternBlocEraKey, makeEasternBlocModel } from "@/lib/seeds/shared/easternBlocModel";
import { plRegionCensusData } from "@/lib/seeds/pl/plRegionCensusData";
import { plRegionCensusData1953 } from "@/lib/seeds/pl/plRegionCensusData1953";

type Census = Record<string, Record<string, Record<string, number>>>;

const ERA_CENSUS: Record<"1953" | "1979", Census> = {
  "1953": plRegionCensusData1953 as unknown as Census,
  "1979": plRegionCensusData as unknown as Census,
};

/**
 * Poland Layer-1 model — standard planned-economy archetypes over the era's own
 * census. Two authored eras (1953 / 1979); the 1991 successor world resolves
 * through `getSuccessor1991Model`, so anything else here resolves to the 1979
 * bundle — except 2027, which uses the modern democratic model below.
 */
export function getPlModel(era: EraId): CountryLayer1Model {
  if (era === "2027") return getPlModernModel();
  const key = easternBlocEraKey(era);
  return makeEasternBlocModel(
    "PL",
    "pl_voterGroups",
    ["polish", "minority", "other"],
    ERA_CENSUS[key],
    era
  );
}

const PL_MODERN_GROUP_IDS = [
  "rural_conservative",
  "urban_civic",
  "agrarian_centre",
  "progressive_left",
  "libertarian_nationalist",
  "silesian_minority",
] as const;

type ModernGroupId = (typeof PL_MODERN_GROUP_IDS)[number];

const MODERN_TURNOUT: CountryLayer1Model["turnoutRates"] = {
  ethnicity: { polish: 74, minority: 58, other: 62 },
  age: { young: 64, mid: 72, mature: 76, senior: 74 },
  education: { primary_or_below: 64, secondary: 70, vocational: 70, university: 80 },
  income: { low: 64, middle: 72, high: 78 },
  urbanization: { urban: 74, suburban: 71, rural: 70 },
};

const MODERN_COMPOSITION: Record<ModernGroupId, CountryLayer1Model["composition"][string]> = {
  rural_conservative: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.35 },
      { dim: "age", key: "mature", w: 0.25 },
      { dim: "education", key: "vocational", w: 0.2 },
      { dim: "ethnicity", key: "polish", w: 0.1 },
      { dim: "income", key: "low", w: 0.1 },
    ],
    civicMultiplier: 1.05,
  },
  urban_civic: {
    weights: [
      { dim: "urbanization", key: "urban", w: 0.35 },
      { dim: "education", key: "university", w: 0.3 },
      { dim: "income", key: "high", w: 0.2 },
      { dim: "age", key: "young", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  agrarian_centre: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.3 },
      { dim: "age", key: "senior", w: 0.25 },
      { dim: "education", key: "primary_or_below", w: 0.2 },
      { dim: "income", key: "middle", w: 0.25 },
    ],
    civicMultiplier: 1.0,
  },
  progressive_left: {
    weights: [
      { dim: "age", key: "young", w: 0.35 },
      { dim: "education", key: "university", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.25 },
      { dim: "income", key: "middle", w: 0.15 },
    ],
    civicMultiplier: 0.95,
  },
  libertarian_nationalist: {
    weights: [
      { dim: "age", key: "young", w: 0.35 },
      { dim: "education", key: "secondary", w: 0.25 },
      { dim: "income", key: "middle", w: 0.2 },
      { dim: "urbanization", key: "suburban", w: 0.2 },
    ],
    civicMultiplier: 0.9,
  },
  silesian_minority: {
    weights: [
      { dim: "ethnicity", key: "minority", w: 0.4 },
      { dim: "income", key: "middle", w: 0.25 },
      { dim: "education", key: "vocational", w: 0.2 },
      { dim: "age", key: "mature", w: 0.15 },
    ],
    civicMultiplier: 0.75,
  },
};

const MODERN_LEANS: Record<ModernGroupId, { economicLean: number; socialLean: number }> = {
  rural_conservative: { economicLean: 0, socialLean: 4 },
  urban_civic: { economicLean: 1, socialLean: -2 },
  agrarian_centre: { economicLean: 0, socialLean: 1 },
  progressive_left: { economicLean: -3, socialLean: -3 },
  libertarian_nationalist: { economicLean: 3, socialLean: 4 },
  silesian_minority: { economicLean: 1, socialLean: 0 },
};

const MODERN_POSITIONS: Record<string, Record<string, DemographicPosition>> = {
  ethnicity: {
    polish: { economicLean: 0, socialLean: 0.5 },
    minority: { economicLean: -0.5, socialLean: 0 },
    other: { economicLean: 0, socialLean: 0 },
  },
  age: {
    young: { economicLean: -0.5, socialLean: -1 },
    mid: { economicLean: 0, socialLean: 0 },
    mature: { economicLean: 0, socialLean: 1 },
    senior: { economicLean: 0.5, socialLean: 2 },
  },
  education: {
    primary_or_below: { economicLean: -0.5, socialLean: 1.5 },
    secondary: { economicLean: 0, socialLean: 0.5 },
    vocational: { economicLean: 0, socialLean: 0.5 },
    university: { economicLean: 1, socialLean: -1.5 },
  },
  income: {
    low: { economicLean: -2, socialLean: 0.5 },
    middle: { economicLean: 0, socialLean: 0 },
    high: { economicLean: 2.5, socialLean: 0 },
  },
  urbanization: {
    urban: { economicLean: 0, socialLean: -1 },
    suburban: { economicLean: 0, socialLean: 0 },
    rural: { economicLean: 0, socialLean: 2 },
  },
};

/**
 * Poland Layer-1 model for the 2027 democratic world: Third-Republic voter
 * groups (the PiS-rural vs KO-urban cleavage, PSL agrarian centre, Lewica
 * progressives, Konfederacja libertarian-nationalists, Silesian/German
 * minority) over the 1979-texture census. Reusing the 1979 census as the 2027
 * texture is a deliberate first-pass fallback (same as HU, whose modern era
 * reuses its 1980 texture) until a modern PL census is authored — the 2027
 * retrofit keeps the same eight region ids, so keys resolve either way.
 */
function getPlModernModel(): CountryLayer1Model {
  const census = Object.fromEntries(
    Object.entries(plRegionCensusData).map(([regionId, layer1]) => [
      regionId,
      {
        ethnicity: (layer1 as { ethnicity: Record<string, number> }).ethnicity as unknown as Record<
          string,
          number
        >,
        age: (layer1 as { age: Record<string, number> }).age as unknown as Record<string, number>,
        education: (layer1 as { education: Record<string, number> }).education as unknown as Record<
          string,
          number
        >,
        income: (layer1 as { income: Record<string, number> }).income as unknown as Record<
          string,
          number
        >,
        urbanization: (layer1 as { urbanization: Record<string, number> })
          .urbanization as unknown as Record<string, number>,
      },
    ])
  );
  return {
    countryId: "PL",
    categoryId: "pl_voterGroups",
    groupIds: [...PL_MODERN_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: MODERN_TURNOUT,
    positions: MODERN_POSITIONS,
    composition: MODERN_COMPOSITION as unknown as CountryLayer1Model["composition"],
    defaultLeans: MODERN_LEANS as unknown as CountryLayer1Model["defaultLeans"],
    census,
  };
}
