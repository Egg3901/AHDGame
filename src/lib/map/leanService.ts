import type { Db } from "mongodb";
import type { State, StateDemographics, DemographicCategory } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { calculateStateLean, getDisplayLean, getLeanLabel } from "@/lib/utils/demographics";
import {
  getLeanLabelHex,
  getSocialLeanLabelHex,
  getUkEconomicLeanLabelHex,
} from "@/lib/utils/politics";

export interface MapLeanState {
  economicLean: number;
  socialLean: number;
  displayLean: number;
  color: string;
  label: string;
  tooltip: string[];
  economicColor: string;
  economicLabel: string;
  socialColor: string;
  socialLabel: string;
}

export async function computeLeanMap(
  db: Db,
  countryId: CountryId
): Promise<Record<string, MapLeanState>> {
  const [allStates, allDemographics, demographicCategories] = await Promise.all([
    db.collection<State>("states").find({ countryId }).toArray(),
    db.collection<StateDemographics>("stateDemographics").find({ countryId }).toArray(),
    db.collection<DemographicCategory>("demographicCategories").find({}).toArray(),
  ]);

  const stateMap = new Map(allStates.map((s) => [s._id, s]));

  if (countryId === COUNTRY_CONFIGS.UK.id || countryId === COUNTRY_CONFIGS.DE.id) {
    return buildLeanUK(allStates, allDemographics, demographicCategories, stateMap);
  }
  return buildLeanUS(allStates, allDemographics, demographicCategories, stateMap);
}

async function buildLeanUS(
  allStates: State[],
  allDemographics: StateDemographics[],
  demographicCategories: DemographicCategory[],
  _stateMap: Map<string, State>
): Promise<Record<string, MapLeanState>> {
  const demoByState = new Map(allDemographics.map((d) => [d._id, d]));
  const result: Record<string, MapLeanState> = {};

  for (const state of allStates) {
    const stateId = state._id;
    const demo = demoByState.get(stateId);
    let economicLean: number;
    let socialLean: number;

    if (state.cachedEconomicLean != null && state.cachedSocialLean != null) {
      economicLean = state.cachedEconomicLean;
      socialLean = state.cachedSocialLean;
    } else if (demo && demographicCategories.length > 0) {
      const c = calculateStateLean(demo, demographicCategories);
      economicLean = c.economicLean;
      socialLean = c.socialLean;
    } else {
      const { ELECTION_2020_MARGIN, marginToLean } = await import("@/lib/data/2020ElectionResults");
      const margin = ELECTION_2020_MARGIN[stateId];
      const lean = margin !== undefined ? marginToLean(margin) : 0;
      economicLean = lean;
      socialLean = lean;
    }

    const displayLean = getDisplayLean(economicLean, socialLean);
    const label = getLeanLabel(displayLean);
    const { color } = getLeanLabelHex(displayLean);
    const econ = getLeanLabelHex(economicLean);
    const social = getSocialLeanLabelHex(socialLean);

    result[stateId] = {
      economicLean,
      socialLean,
      displayLean,
      color,
      label,
      economicColor: econ.color,
      economicLabel: econ.label,
      socialColor: social.color,
      socialLabel: social.label,
      tooltip: [
        state.name ?? stateId,
        `Political Lean: ${label}`,
        `Economic: ${economicLean >= 0 ? "+" : ""}${economicLean.toFixed(2)} · Social: ${socialLean >= 0 ? "+" : ""}${socialLean.toFixed(2)}`,
        "From demographics (weighted avg)",
      ],
    };
  }
  return result;
}

async function buildLeanUK(
  allStates: State[],
  allDemographics: StateDemographics[],
  demographicCategories: DemographicCategory[],
  _stateMap: Map<string, State>
): Promise<Record<string, MapLeanState>> {
  const demoByState = new Map(allDemographics.map((d) => [d._id, d]));
  const result: Record<string, MapLeanState> = {};

  for (const state of allStates) {
    const stateId = state._id;
    const regionId = stateId;
    const demo = demoByState.get(stateId);
    let economicLean: number;
    let socialLean: number;

    if (state.cachedEconomicLean != null && state.cachedSocialLean != null) {
      economicLean = state.cachedEconomicLean;
      socialLean = state.cachedSocialLean;
    } else if (demo && demographicCategories.length > 0) {
      const c = calculateStateLean(demo, demographicCategories);
      economicLean = c.economicLean;
      socialLean = c.socialLean;
    } else {
      economicLean = 0;
      socialLean = 0;
    }

    const displayLean = getDisplayLean(economicLean, socialLean);
    const label = getLeanLabel(displayLean);
    const combined = getUkEconomicLeanLabelHex(displayLean);
    const econ = getUkEconomicLeanLabelHex(economicLean);
    const socialMeta = getSocialLeanLabelHex(socialLean);
    const socialColor = getUkEconomicLeanLabelHex(socialLean).color;

    result[regionId] = {
      economicLean,
      socialLean,
      displayLean,
      color: combined.color,
      label,
      economicColor: econ.color,
      economicLabel: econ.label,
      socialColor,
      socialLabel: socialMeta.label,
      tooltip: [
        state.name ?? stateId,
        `Political Lean: ${label}`,
        `Economic: ${economicLean >= 0 ? "+" : ""}${economicLean.toFixed(2)} · Social: ${socialLean >= 0 ? "+" : ""}${socialLean.toFixed(2)}`,
      ],
    };
  }
  return result;
}
