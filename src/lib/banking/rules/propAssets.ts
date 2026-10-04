import type { PropPosition } from "@/lib/db/types/bank";

const LEGACY_ASSETS: readonly PropPosition["asset"][] = ["equity", "bond", "indexUnit", "forex"];
const PLAYER_ASSETS: readonly PropPosition["asset"][] = ["bond", "indexUnit", "forex"];

/** The fresh player cohort limits new risk; existing books retain all exit rails. */
export function allowedPropOpeningAssets(
  advancedPlayerCharters: boolean,
  ceoType: "character" | "npp" | undefined
): readonly PropPosition["asset"][] {
  return advancedPlayerCharters && ceoType !== "npp" ? PLAYER_ASSETS : LEGACY_ASSETS;
}
