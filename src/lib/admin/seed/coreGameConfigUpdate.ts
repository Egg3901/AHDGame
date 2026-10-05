import type { UpdateFilter } from "mongodb";
import type { GameConfig } from "@/lib/db/types";
import { gameConfig } from "@/lib/seeds/reference/gameConfig";
import { playerInvestmentBankingSeedFlags } from "@/lib/banking/rules/charterAccess";
import { splitFreshWorldGameConfigFlags } from "@/lib/seeds/reference/featureFlagDefaults";

/**
 * Provenance stamps for `marketSystemMode`, cleared only when a reset re-adopts
 * the reference tier. They name the human who set the *previous* world's tier,
 * so leaving them on a world whose tier the seed just chose would attribute a
 * seed default to an operator who never made that call for this world.
 */
export const STALE_MARKET_MODE_STAMP_UNSET: Readonly<Record<string, "">> = Object.freeze({
  marketSystemModeUpdatedBy: "",
  marketSystemModeUpdatedAt: "",
  marketSystemModeUpdatedTurn: "",
});

/**
 * Configuration writes shared by core reset and non-destructive seed top-ups.
 *
 * A reset is a fresh world, so it writes the full fresh-world flag preset. A
 * top-up writes flag and switch fields only on insertion: it must never flip a
 * gate on a running world, in either direction.
 */
export function coreGameConfigUpdate(reset: boolean, seedYear: number): UpdateFilter<GameConfig> {
  const { settings, flags } = splitFreshWorldGameConfigFlags(gameConfig);
  const investmentBanking = playerInvestmentBankingSeedFlags(seedYear);
  return reset
    ? {
        $set: { ...settings, ...flags, ...investmentBanking, seedYear },
        $unset: STALE_MARKET_MODE_STAMP_UNSET,
      }
    : {
        $set: { ...settings, seedYear },
        $setOnInsert: { ...flags, ...investmentBanking },
      };
}
