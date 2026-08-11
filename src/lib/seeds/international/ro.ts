import type { CountryLayer1Model } from "./types";
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
 * census. Two authored eras (1953 / 1979); post-Soviet eras never seed this
 * country, so anything else resolves to the 1979 bundle.
 */
export function getRoModel(era: EraId): CountryLayer1Model {
  const key = easternBlocEraKey(era);
  return makeEasternBlocModel(
    "RO",
    "ro_voterGroups",
    ["romanian", "hungarian", "other"],
    ERA_CENSUS[key],
    era
  );
}
