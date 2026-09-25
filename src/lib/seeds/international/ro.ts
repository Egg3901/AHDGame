import type { CountryLayer1Model, DemographicPosition } from "./types";
import type { EraId } from "@/lib/seeds/presetSelector";
import { easternBlocEraKey, makeEasternBlocModel } from "@/lib/seeds/shared/easternBlocModel";
import { roRegionCensusData } from "@/lib/seeds/ro/roRegionCensusData";
import { roRegionCensusData1953 } from "@/lib/seeds/ro/roRegionCensusData1953";

type Census = Record<string, Record<string, Record<string, number>>>;

const ERA_CENSUS: Record<"1953" | "1979", Census> = {
  "1953": roRegionCensusData1953 as unknown as Census,
  "1979": roRegionCensusData as unknown as Census,
};

/**
 * Romania Layer-1 model — standard planned-economy archetypes over the era's own
 * census. Two authored eras (1953 / 1979); the 1991 successor world resolves
 * through `getSuccessor1991Model`, so anything else here resolves to the 1979
 * bundle — except 2027, which uses the modern democratic model below.
 */
export function getRoModel(era: EraId): CountryLayer1Model {
  if (era === "2027") return getRoModernModel();
  const key = easternBlocEraKey(era);
  return makeEasternBlocModel(
    "RO",
    "ro_voterGroups",
    ["romanian", "hungarian", "other"],
    ERA_CENSUS[key],
    era
  );
}

const RO_MODERN_GROUP_IDS = [
  "social_rural",
  "urban_reformist",
  "nationalist_populist",
  "liberal_centre",
  "hungarian_minority",
  "green_youth",
] as const;

type ModernGroupId = (typeof RO_MODERN_GROUP_IDS)[number];

const MODERN_TURNOUT: CountryLayer1Model["turnoutRates"] = {
  ethnicity: { romanian: 54, hungarian: 58, other: 48 },
  age: { young: 44, mid: 52, mature: 56, senior: 54 },
  education: { primary_or_below: 46, secondary: 50, vocational: 50, university: 62 },
  income: { low: 46, middle: 52, high: 60 },
  urbanization: { urban: 54, suburban: 51, rural: 50 },
};

const MODERN_COMPOSITION: Record<ModernGroupId, CountryLayer1Model["composition"][string]> = {
  social_rural: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.35 },
      { dim: "age", key: "senior", w: 0.25 },
      { dim: "income", key: "low", w: 0.2 },
      { dim: "education", key: "primary_or_below", w: 0.2 },
    ],
    civicMultiplier: 1.0,
  },
  urban_reformist: {
    weights: [
      { dim: "urbanization", key: "urban", w: 0.35 },
      { dim: "education", key: "university", w: 0.3 },
      { dim: "age", key: "young", w: 0.2 },
      { dim: "income", key: "high", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  nationalist_populist: {
    weights: [
      { dim: "age", key: "young", w: 0.3 },
      { dim: "income", key: "low", w: 0.25 },
      { dim: "education", key: "secondary", w: 0.25 },
      { dim: "urbanization", key: "rural", w: 0.2 },
    ],
    civicMultiplier: 0.95,
  },
  liberal_centre: {
    weights: [
      { dim: "income", key: "middle", w: 0.3 },
      { dim: "education", key: "university", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.25 },
      { dim: "age", key: "mid", w: 0.2 },
    ],
    civicMultiplier: 1.0,
  },
  hungarian_minority: {
    weights: [
      { dim: "ethnicity", key: "hungarian", w: 0.45 },
      { dim: "income", key: "middle", w: 0.2 },
      { dim: "education", key: "secondary", w: 0.2 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 0.9,
  },
  green_youth: {
    weights: [
      { dim: "age", key: "young", w: 0.4 },
      { dim: "education", key: "university", w: 0.3 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "income", key: "middle", w: 0.1 },
    ],
    civicMultiplier: 0.85,
  },
};

const MODERN_LEANS: Record<ModernGroupId, { economicLean: number; socialLean: number }> = {
  social_rural: { economicLean: -2, socialLean: 2 },
  urban_reformist: { economicLean: 1, socialLean: -2 },
  nationalist_populist: { economicLean: 0, socialLean: 5 },
  liberal_centre: { economicLean: 2, socialLean: 0 },
  hungarian_minority: { economicLean: 0, socialLean: 1 },
  green_youth: { economicLean: -1, socialLean: -4 },
};

const MODERN_POSITIONS: Record<string, Record<string, DemographicPosition>> = {
  ethnicity: {
    romanian: { economicLean: 0, socialLean: 0.5 },
    hungarian: { economicLean: 0, socialLean: 1 },
    other: { economicLean: 0, socialLean: 0 },
  },
  age: {
    young: { economicLean: -0.5, socialLean: -1.5 },
    mid: { economicLean: 0, socialLean: 0 },
    mature: { economicLean: 0, socialLean: 1 },
    senior: { economicLean: -0.5, socialLean: 2 },
  },
  education: {
    primary_or_below: { economicLean: -1, socialLean: 1.5 },
    secondary: { economicLean: 0, socialLean: 0.5 },
    vocational: { economicLean: 0, socialLean: 0.5 },
    university: { economicLean: 1, socialLean: -1.5 },
  },
  income: {
    low: { economicLean: -2, socialLean: 0.5 },
    middle: { economicLean: 0, socialLean: 0 },
    high: { economicLean: 2, socialLean: 0 },
  },
  urbanization: {
    urban: { economicLean: 0, socialLean: -1 },
    suburban: { economicLean: 0, socialLean: 0 },
    rural: { economicLean: -0.5, socialLean: 2 },
  },
};

/**
 * Romania Layer-1 model for the 2027 democratic world: post-1989 voter groups
 * (the PSD rural south vs USR urban reformists, AUR nationalist populists,
 * PNL liberal centre, the UDMR Hungarian minority in Transylvania, green
 * youth) over the 1979-texture census. Reusing the 1979 census as the 2027
 * texture is a deliberate first-pass fallback (same as HU/PL) until a modern
 * RO census is authored — the 2027 retrofit keeps the same seven region ids,
 * so keys resolve either way.
 */
function getRoModernModel(): CountryLayer1Model {
  const census = Object.fromEntries(
    Object.entries(roRegionCensusData).map(([regionId, layer1]) => [
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
    countryId: "RO",
    categoryId: "ro_voterGroups",
    groupIds: [...RO_MODERN_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: MODERN_TURNOUT,
    positions: MODERN_POSITIONS,
    composition: MODERN_COMPOSITION as unknown as CountryLayer1Model["composition"],
    defaultLeans: MODERN_LEANS as unknown as CountryLayer1Model["defaultLeans"],
    census,
  };
}
