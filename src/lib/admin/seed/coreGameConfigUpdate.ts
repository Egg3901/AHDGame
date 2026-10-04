import type { UpdateFilter } from "mongodb";
import type { GameConfig } from "@/lib/db/types";
import { gameConfig } from "@/lib/seeds/reference/gameConfig";

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
 * Provenance stamps for `freightSettlementMode`, cleared on the same terms as the
 * market-tier stamps above. The reference seed carries the "shadow" tier, so a
 * reset puts it back, and stamps naming who moved the previous world's freight
 * tier (and on which of that world's turns) would otherwise describe a change this
 * world never had. Written only by `/api/admin/config/freight-settlement`; no
 * reader consumes them.
 */
export const STALE_FREIGHT_MODE_STAMP_UNSET: Readonly<Record<string, "">> = Object.freeze({
  freightSettlementModeUpdatedBy: "",
  freightSettlementModeUpdatedAt: "",
  freightSettlementModeUpdatedTurn: "",
});

/** Configuration writes shared by core reset and non-destructive seed top-ups. */
export function coreGameConfigUpdate(reset: boolean, seedYear: number): UpdateFilter<GameConfig> {
  const { marketSystemMode, campaignEraPriceLevelEnabled, ...reference } = gameConfig;
  // These economy modes change only on a deliberate reset or first insertion.
  // Existing absent campaign flags retain the legacy pricing contract.
  return reset
    ? {
        $set: { ...reference, seedYear, marketSystemMode, campaignEraPriceLevelEnabled },
        $unset: { ...STALE_MARKET_MODE_STAMP_UNSET, ...STALE_FREIGHT_MODE_STAMP_UNSET },
      }
    : {
        $set: { ...reference, seedYear },
        $setOnInsert: { marketSystemMode, campaignEraPriceLevelEnabled },
      };
}
