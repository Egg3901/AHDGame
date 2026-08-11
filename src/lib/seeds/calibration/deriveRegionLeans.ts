import {
  editorConfigFromSeed,
  computeDerivedComposition,
  editorConfigFromCountryModel,
  computeDerivedCompositionGeneric,
} from "@/lib/positionEditor/derive";
import { stateCensusData } from "@/lib/seeds/stateCensusData";
import { stateCensusData1953 } from "@/lib/seeds/stateCensusData1953";
import { stateCensusData1979 } from "@/lib/seeds/stateCensusData1979";
import { stateCensusData1991 } from "@/lib/seeds/stateCensusData1991";
import { stateCensusData1999 } from "@/lib/seeds/stateCensusData1999";
import { stateCensusData2007 } from "@/lib/seeds/stateCensusData2007";
import { stateCensusData2023 } from "@/lib/seeds/stateCensusData2023";
import { getCountryLayer1Model } from "@/lib/seeds/international";
import type { Layer1Config } from "@/lib/seeds/stateDemographics";
import type { EraId } from "@/lib/seeds/presetSelector";
import type { RegionLean } from "./types";

const US_CENSUS: Record<EraId, Record<string, Layer1Config>> = {
  // 1953: 1979 shares proxy with the 1979-authored positions blocks stripped.
  "1953": stateCensusData1953 as unknown as Record<string, Layer1Config>,
  "1979": stateCensusData1979 as unknown as Record<string, Layer1Config>,
  "1991": stateCensusData1991 as unknown as Record<string, Layer1Config>,
  "1999": stateCensusData1999 as unknown as Record<string, Layer1Config>,
  "2007": stateCensusData2007 as unknown as Record<string, Layer1Config>,
  "2019": stateCensusData as unknown as Record<string, Layer1Config>,
  "2023": stateCensusData2023 as unknown as Record<string, Layer1Config>,
};

/**
 * Derive per-region econ/social/display leans using the SAME path as the preset
 * route and the live seed. US uses the US engine; others use the generic path.
 */
export function deriveRegionLeans(country: string, era: EraId): RegionLean[] {
  if (country === "US") {
    return Object.entries(US_CENSUS[era]).map(([stateId, cfg]) => {
      const ed = editorConfigFromSeed(stateId, "US", era, cfg);
      const d = computeDerivedComposition(ed);
      return {
        regionId: stateId,
        economic: d.stateEconomicLean,
        social: d.stateSocialLean,
        display: d.stateDisplayLean,
      };
    });
  }
  const model = getCountryLayer1Model(country, era);
  if (!model) return [];
  return Object.keys(model.census).map((regionId) => {
    const ed = editorConfigFromCountryModel(model, regionId, era, {});
    const d = computeDerivedCompositionGeneric(ed);
    return {
      regionId,
      economic: d.stateEconomicLean,
      social: d.stateSocialLean,
      display: d.stateDisplayLean,
    };
  });
}
