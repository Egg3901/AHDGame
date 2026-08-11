import type { EraId } from "@/lib/seeds/presetSelector";
import type { CountryLayer1Model } from "./types";
import { scoRegionCensusData } from "@/lib/seeds/sco/scoRegionCensusData";
import { makeDevolvedNationModel } from "@/lib/seeds/shared/devolvedNationModel";

/**
 * Scotland's Layer-1 model — its own seven Holyrood macro-regions, with the UK's
 * voter groups, positions and turnout for the era. See `devolvedNationModel.ts`
 * for why the historical census is derived rather than authored.
 */
export function getScoModel(era: EraId): CountryLayer1Model {
  return makeDevolvedNationModel("SCO", scoRegionCensusData, era);
}
