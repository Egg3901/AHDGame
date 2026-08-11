import type { EraId } from "@/lib/seeds/presetSelector";
import type { CountryLayer1Model } from "./types";
import { walRegionCensusData } from "@/lib/seeds/wal/walRegionCensusData";
import { makeDevolvedNationModel } from "@/lib/seeds/shared/devolvedNationModel";

/**
 * Wales's Layer-1 model — its own six Senedd macro-regions, with the UK's voter
 * groups, positions and turnout for the era. See `devolvedNationModel.ts` for
 * why the historical census is derived rather than authored.
 */
export function getWalModel(era: EraId): CountryLayer1Model {
  return makeDevolvedNationModel("WAL", walRegionCensusData, era);
}
