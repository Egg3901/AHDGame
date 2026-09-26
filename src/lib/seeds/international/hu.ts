import type { CountryLayer1Model, DemographicPosition } from "./types";
import type { EraId } from "@/lib/seeds/presetSelector";
import { easternBlocEraKey, makeEasternBlocModel } from "@/lib/seeds/shared/easternBlocModel";
import { huRegionCensusData, type HURegionLayer1 } from "@/lib/seeds/hu/huRegionCensusData";
import { huRegionCensusData1953 } from "@/lib/seeds/hu/huRegionCensusData1953";

type Census = Record<string, Record<string, Record<string, number>>>;

const ERA_CENSUS: Record<"1953" | "1979", Census> = {
  "1953": huRegionCensusData1953 as unknown as Census,
  "1979": huRegionCensusData as unknown as Census,
};

/**
 * Hungary Layer-1 model — standard planned-economy archetypes over the era's own
 * census. Two authored eras (1953 / 1979); post-Soviet eras never seed this
 * country, so anything else resolves to the 1979 bundle.
 */
export function getHuModel(era: EraId): CountryLayer1Model {
  if (era === "2027") return getHuModernModel();
  const key = easternBlocEraKey(era);
  return makeEasternBlocModel(
    "HU",
    "hu_voterGroups",
    ["hungarian", "minority", "other"],
    ERA_CENSUS[key],
    era
  );
}

const HU_MODERN_GROUP_IDS = [
  "national_conservative",
  "christian_rural",
  "urban_liberal",
  "socialist_left",
  "green_youth",
  "roma_minority",
] as const;

type ModernGroupId = (typeof HU_MODERN_GROUP_IDS)[number];

const MODERN_TURNOUT: CountryLayer1Model["turnoutRates"] = {
  ethnicity: { hungarian: 70, minority: 55, other: 60 },
  age: { young: 62, mid: 70, mature: 74, senior: 72 },
  education: { primary_or_below: 62, secondary: 68, vocational: 68, university: 78 },
  income: { low: 62, middle: 70, high: 76 },
  urbanization: { urban: 71, suburban: 69, rural: 68 },
};

const MODERN_COMPOSITION: Record<ModernGroupId, CountryLayer1Model["composition"][string]> = {
  national_conservative: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.3 },
      { dim: "age", key: "mature", w: 0.25 },
      { dim: "education", key: "vocational", w: 0.2 },
      { dim: "ethnicity", key: "hungarian", w: 0.15 },
      { dim: "income", key: "middle", w: 0.1 },
    ],
    civicMultiplier: 1.05,
  },
  christian_rural: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.35 },
      { dim: "age", key: "senior", w: 0.25 },
      { dim: "education", key: "primary_or_below", w: 0.2 },
      { dim: "income", key: "low", w: 0.2 },
    ],
    civicMultiplier: 1.0,
  },
  urban_liberal: {
    weights: [
      { dim: "urbanization", key: "urban", w: 0.35 },
      { dim: "education", key: "university", w: 0.3 },
      { dim: "income", key: "high", w: 0.2 },
      { dim: "age", key: "young", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  socialist_left: {
    weights: [
      { dim: "income", key: "low", w: 0.35 },
      { dim: "urbanization", key: "urban", w: 0.25 },
      { dim: "education", key: "vocational", w: 0.2 },
      { dim: "age", key: "mature", w: 0.2 },
    ],
    civicMultiplier: 1.0,
  },
  green_youth: {
    weights: [
      { dim: "age", key: "young", w: 0.4 },
      { dim: "education", key: "university", w: 0.3 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "income", key: "middle", w: 0.1 },
    ],
    civicMultiplier: 0.9,
  },
  roma_minority: {
    weights: [
      { dim: "ethnicity", key: "minority", w: 0.4 },
      { dim: "income", key: "low", w: 0.3 },
      { dim: "education", key: "primary_or_below", w: 0.2 },
      { dim: "age", key: "young", w: 0.1 },
    ],
    civicMultiplier: 0.7,
  },
};

const MODERN_LEANS: Record<ModernGroupId, { economicLean: number; socialLean: number }> = {
  national_conservative: { economicLean: 1, socialLean: 4 },
  christian_rural: { economicLean: 0, socialLean: 5 },
  urban_liberal: { economicLean: 1, socialLean: -3 },
  socialist_left: { economicLean: -3, socialLean: -1 },
  green_youth: { economicLean: -1, socialLean: -4 },
  roma_minority: { economicLean: -2, socialLean: 1 },
};

const MODERN_POSITIONS: Record<string, Record<string, DemographicPosition>> = {
  ethnicity: {
    hungarian: { economicLean: 0, socialLean: 0.5 },
    minority: { economicLean: -1, socialLean: 0 },
    other: { economicLean: 0, socialLean: 0 },
  },
  age: {
    young: { economicLean: -1, socialLean: -1.5 },
    mid: { economicLean: -0.5, socialLean: 0 },
    mature: { economicLean: 0, socialLean: 1 },
    senior: { economicLean: 0.5, socialLean: 2 },
  },
  education: {
    primary_or_below: { economicLean: -0.5, socialLean: 1.5 },
    secondary: { economicLean: 0, socialLean: 0.5 },
    vocational: { economicLean: -1, socialLean: 0.5 },
    university: { economicLean: 1, socialLean: -1.5 },
  },
  income: {
    low: { economicLean: -2, socialLean: 0.5 },
    middle: { economicLean: 0, socialLean: 0 },
    high: { economicLean: 2.5, socialLean: 0.5 },
  },
  urbanization: {
    urban: { economicLean: 0, socialLean: -1 },
    suburban: { economicLean: -0.5, socialLean: -0.5 },
    rural: { economicLean: 0, socialLean: 2 },
  },
};

/**
 * Hungary Layer-1 model for the 2027 democratic world: Third-Republic voter
 * groups over the 1980-texture census. Reusing the 1980 census as the 2027
 * texture is a deliberate first-pass fallback (same as FI/GR, whose modern
 * eras reuse their 1979 census) until a modern HU census is authored — the
 * 2027 retrofit keeps the same six region ids, so keys resolve either way.
 */
function getHuModernModel(): CountryLayer1Model {
  const census = Object.fromEntries(
    Object.entries(huRegionCensusData).map(([regionId, layer1]: [string, HURegionLayer1]) => [
      regionId,
      {
        ethnicity: layer1.ethnicity as unknown as Record<string, number>,
        age: layer1.age as unknown as Record<string, number>,
        education: layer1.education as unknown as Record<string, number>,
        income: layer1.income as unknown as Record<string, number>,
        urbanization: layer1.urbanization as unknown as Record<string, number>,
      },
    ])
  );
  return {
    countryId: "HU",
    categoryId: "hu_voterGroups",
    groupIds: [...HU_MODERN_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: MODERN_TURNOUT,
    positions: MODERN_POSITIONS,
    composition: MODERN_COMPOSITION as unknown as CountryLayer1Model["composition"],
    defaultLeans: MODERN_LEANS as unknown as CountryLayer1Model["defaultLeans"],
    census,
  };
}
