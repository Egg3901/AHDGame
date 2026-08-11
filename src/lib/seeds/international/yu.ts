import type { CountryLayer1Model } from "./types";
import type { EraId } from "@/lib/seeds/presetSelector";
import { easternBlocEraKey, makeEasternBlocModel } from "@/lib/seeds/shared/easternBlocModel";
import { yuRegionCensusData } from "@/lib/seeds/yu/yuRegionCensusData";
import { yuRegionCensusData1953 } from "@/lib/seeds/yu/yuRegionCensusData1953";

type Census = Record<string, Record<string, Record<string, number>>>;

const ERA_CENSUS: Record<"1953" | "1979", Census> = {
  "1953": yuRegionCensusData1953 as unknown as Census,
  "1979": yuRegionCensusData as unknown as Census,
};

/**
 * Yugoslavia Layer-1 model — standard planned-economy archetypes over the era's own
 * census. Two authored eras (1953 / 1979); post-Soviet eras never seed this
 * country, so anything else resolves to the 1979 bundle.
 */
export function getYuModel(era: EraId): CountryLayer1Model {
  const key = easternBlocEraKey(era);
  return makeEasternBlocModel(
    "YU",
    "yu_voterGroups",
    ["south_slav", "albanian", "other"],
    ERA_CENSUS[key],
    era
  );
}
