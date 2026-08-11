import type { Campaign } from "@/lib/db/types";
import { getMaintenanceCost } from "./upgradeCosts";

/**
 * Per-turn maintenance costs for a campaign's groundGame and mediaSpending
 * upgrade levels. `electionType` is the campaign's election family — when
 * supplied, the per-race-family budget scalar shrinks maintenance to the
 * race's realistic spend tier (state-senate races shouldn't drain
 * presidential-scale upkeep).
 */
export function calculateMaintenanceCosts(campaign: Campaign, electionType?: string): number {
  const groundGameMaintenance = getMaintenanceCost(
    "groundGame",
    campaign.groundGameLevel,
    electionType
  );
  const mediaMaintenance = getMaintenanceCost(
    "mediaSpending",
    campaign.mediaSpendingLevel,
    electionType
  );

  return groundGameMaintenance + mediaMaintenance;
}
