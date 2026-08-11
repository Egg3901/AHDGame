import type { CountryLayer1Model } from "./types";
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
 * Bulgaria Layer-1 model — standard planned-economy archetypes over the era's own
 * census. Two authored eras (1953 / 1979); post-Soviet eras never seed this
 * country, so anything else resolves to the 1979 bundle.
 */
export function getBgModel(era: EraId): CountryLayer1Model {
  const key = easternBlocEraKey(era);
  return makeEasternBlocModel(
    "BG",
    "bg_voterGroups",
    ["bulgarian", "turkish", "other"],
    ERA_CENSUS[key],
    era
  );
}
