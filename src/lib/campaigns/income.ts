import type { Campaign } from "@/lib/db/types";
import { FUNDRAISING_INCOME, getCampaignFamilyScalar } from "./upgradeCosts";

/**
 * Per-turn passive income for a campaign based on fundraisingLevel (0–10).
 * Uses FUNDRAISING_INCOME lookup table. Character stats do not contribute.
 *
 * When `electionType` is supplied, applies the per-race-family budget
 * scalar from `CAMPAIGN_FAMILY_SCALAR_BY_ELECTION_TYPE` so state-senate
 * candidates don't pull presidential-scale fundraising. Backward-compat:
 * no scalar applied when electionType is undefined (existing callers
 * see no change until they're updated to pass the type).
 */
export function calculateCampaignIncome(campaign: Campaign, electionType?: string): number {
  const level = Math.min(Math.max(campaign.fundraisingLevel, 0), 10);
  const base = FUNDRAISING_INCOME[level];
  const scalar = getCampaignFamilyScalar(electionType);
  return Math.round(base * scalar);
}
