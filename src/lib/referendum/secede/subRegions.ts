import type { State } from "@/lib/db/types";
import { scoRegions } from "@/lib/seeds/sco/scoRegions";
import { walRegions } from "@/lib/seeds/wal/walRegions";

export type SecedingCountryId = "SCO" | "WAL";

/** SP1 latent sub-region seed maps, keyed by seceding country. */
export const SUB_REGION_SEEDS: Record<SecedingCountryId, State[]> = {
  SCO: scoRegions,
  WAL: walRegions,
};

/**
 * Capital sub-region per seceding country — the re-home target for residents and
 * the single-region devolved-government artifacts (statePolicies/stateBills/
 * governor-office records) when the aggregate region fans out.
 */
export const CAPITAL_SUBREGION: Record<SecedingCountryId, string> = {
  SCO: "LOT", // Edinburgh & the Lothians
  WAL: "CDF", // Cardiff & South East
};
