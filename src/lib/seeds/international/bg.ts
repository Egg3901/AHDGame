import type { CountryLayer1Model, DemographicPosition } from "./types";
import type { EraId } from "@/lib/seeds/presetSelector";
import { easternBlocEraKey, makeEasternBlocModel } from "@/lib/seeds/shared/easternBlocModel";
import { bgRegionCensusData } from "@/lib/seeds/bg/bgRegionCensusData";
import { bgRegionCensusData1953 } from "@/lib/seeds/bg/bgRegionCensusData1953";

type Census = Record<string, Record<string, Record<string, number>>>;

const ERA_CENSUS: Record<"1953" | "1979", Census> = {
  "1953": bgRegionCensusData1953 as unknown as Census,
  "1979": bgRegionCensusData as unknown as Census,
};

/**
 * Bulgaria Layer-1 model: standard planned-economy archetypes over the era's own
 * census for 1953 / 1979; the 1991 successor world resolves through
 * `getSuccessor1991Model`. 2027 uses the modern democratic model below.
 */
export function getBgModel(era: EraId): CountryLayer1Model {
  if (era === "2027") return getBgModernModel();
  const key = easternBlocEraKey(era);
  return makeEasternBlocModel(
    "BG",
    "bg_voterGroups",
    ["bulgarian", "turkish", "other"],
    ERA_CENSUS[key],
    era
  );
}

export const BG_MODERN_GROUP_IDS = [
  "social_conservative",
  "urban_reformist",
  "centre_right",
  "turkish_minority",
  "nationalist",
] as const;

type ModernGroupId = (typeof BG_MODERN_GROUP_IDS)[number];

/**
 * Texture source for each 2027 NUTS II region: the authored 1979 region it
 * overlaps most. Reusing the 1979 texture is a deliberate first-pass fallback,
 * the same one HU/PL/RO use, until a modern NSI census bundle is authored.
 * Population and GDP come from the 2027 region rows, not from this texture.
 */
const BG_2027_TEXTURE_SOURCE: Record<string, keyof typeof bgRegionCensusData> = {
  BG31: "BG_NOR",
  BG32: "BG_NOR",
  BG33: "BG_COA",
  BG34: "BG_COA",
  BG41: "BG_SOF",
  BG42: "BG_THR",
};

// Gameplay estimates, kept below the 2021 to 2024 parliamentary cycles whose
// official national turnouts ranged from about 34% to 50%.
const MODERN_TURNOUT: CountryLayer1Model["turnoutRates"] = {
  ethnicity: { bulgarian: 44, turkish: 46, other: 34 },
  age: { young: 32, mid: 42, mature: 48, senior: 52 },
  education: { primary_or_below: 36, secondary: 42, vocational: 42, university: 54 },
  income: { low: 38, middle: 44, high: 50 },
  urbanization: { urban: 45, suburban: 43, rural: 41 },
};

const MODERN_COMPOSITION: Record<ModernGroupId, CountryLayer1Model["composition"][string]> = {
  social_conservative: {
    weights: [
      { dim: "age", key: "senior", w: 0.35 },
      { dim: "urbanization", key: "rural", w: 0.25 },
      { dim: "income", key: "low", w: 0.25 },
      { dim: "education", key: "primary_or_below", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  urban_reformist: {
    weights: [
      { dim: "urbanization", key: "urban", w: 0.35 },
      { dim: "education", key: "university", w: 0.35 },
      { dim: "age", key: "young", w: 0.2 },
      { dim: "income", key: "high", w: 0.1 },
    ],
    civicMultiplier: 1.0,
  },
  centre_right: {
    weights: [
      { dim: "income", key: "middle", w: 0.35 },
      { dim: "age", key: "mature", w: 0.25 },
      { dim: "education", key: "secondary", w: 0.2 },
      { dim: "urbanization", key: "suburban", w: 0.2 },
    ],
    civicMultiplier: 1.0,
  },
  turkish_minority: {
    weights: [
      { dim: "ethnicity", key: "turkish", w: 0.55 },
      { dim: "urbanization", key: "rural", w: 0.2 },
      { dim: "income", key: "low", w: 0.15 },
      { dim: "age", key: "mid", w: 0.1 },
    ],
    civicMultiplier: 0.95,
  },
  nationalist: {
    weights: [
      { dim: "age", key: "mid", w: 0.3 },
      { dim: "education", key: "vocational", w: 0.25 },
      { dim: "income", key: "low", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.2 },
    ],
    civicMultiplier: 0.9,
  },
};

// Leans sit next to the 2027 roster positions (PB -1/1, GERB-SDS 2/1,
// PP-DB 1/-2, DPS 1/0, Revival 0/5) so each group has a natural home party.
const MODERN_LEANS: Record<ModernGroupId, { economicLean: number; socialLean: number }> = {
  social_conservative: { economicLean: -2, socialLean: 2 },
  urban_reformist: { economicLean: 1, socialLean: -2 },
  centre_right: { economicLean: 2, socialLean: 1 },
  turkish_minority: { economicLean: 0, socialLean: 0 },
  nationalist: { economicLean: 0, socialLean: 5 },
};

const MODERN_POSITIONS: Record<string, Record<string, DemographicPosition>> = {
  ethnicity: {
    bulgarian: { economicLean: 0, socialLean: 0.5 },
    turkish: { economicLean: 0, socialLean: 0 },
    other: { economicLean: -0.5, socialLean: 0 },
  },
  age: {
    young: { economicLean: 0.5, socialLean: -1.5 },
    mid: { economicLean: 0, socialLean: 0 },
    mature: { economicLean: 0, socialLean: 1 },
    senior: { economicLean: -1, socialLean: 2 },
  },
  education: {
    primary_or_below: { economicLean: -1, socialLean: 1.5 },
    secondary: { economicLean: 0, socialLean: 0.5 },
    vocational: { economicLean: 0, socialLean: 1 },
    university: { economicLean: 1, socialLean: -1.5 },
  },
  income: {
    low: { economicLean: -2, socialLean: 0.5 },
    middle: { economicLean: 0, socialLean: 0 },
    high: { economicLean: 2, socialLean: -0.5 },
  },
  urbanization: {
    urban: { economicLean: 0, socialLean: -1 },
    suburban: { economicLean: 0, socialLean: 0 },
    rural: { economicLean: -0.5, socialLean: 2 },
  },
};

function getBgModernModel(): CountryLayer1Model {
  const census: Census = Object.fromEntries(
    Object.entries(BG_2027_TEXTURE_SOURCE).map(([regionId, sourceId]) => [
      regionId,
      structuredClone(bgRegionCensusData[sourceId]) as unknown as Census[string],
    ])
  );
  return {
    countryId: "BG",
    categoryId: "bg_voterGroups",
    groupIds: [...BG_MODERN_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: MODERN_TURNOUT,
    positions: MODERN_POSITIONS,
    composition: MODERN_COMPOSITION as unknown as CountryLayer1Model["composition"],
    defaultLeans: MODERN_LEANS as unknown as CountryLayer1Model["defaultLeans"],
    census,
  };
}
