/**
 * Per-party spend aggregator for the swing-flow engine's money driver.
 *
 * Implements A2 from `2026-05-22-swing-flow-driver-activation.md`. The
 * money driver reads "active pacing" (spend-this-turn) rather than
 * "treasury sitting balance" — see the driver math in
 * `persuasionDrivers.ts:149` for the log-ratio shape.
 *
 * `spendThisTurn` is $inc'd at every campaign spend write (upgrade
 * purchases in `campaignCommands.ts`, maintenance ticks in
 * `campaignTurn.ts`) and reset to 0 via `campaignSpendReset.ts` after
 * each turn's voteAccumulation phase. Missing / undefined values
 * degrade to 0 — backward-compat with pre-A2 rows.
 */

import type { Db, ObjectId } from "mongodb";
import type { Campaign } from "@/lib/db/types";

/**
 * Aggregate `Campaign.spendThisTurn` by party for a single election.
 *
 * Sums every campaign in the race by their party, returning a Map keyed
 * by party ID with the per-party spend total. Parties with zero spend
 * are omitted (driver treats them as 0 via Map.get(p) ?? 0).
 *
 * Returns an empty Map when:
 *   - no campaigns exist for the election (early-cycle NPP races, etc.)
 *   - every campaign has `spendThisTurn` undefined or zero
 *
 * Either case is fine — the money driver returns 0 when fundsJ and
 * fundsI are both 0.
 */
export async function getFundsByPartyForElection(
  electionId: ObjectId,
  db: Db
): Promise<Map<string, number>> {
  const campaigns = await db
    .collection<Campaign>("campaigns")
    .find({ electionId })
    .project<{ party: string; spendThisTurn?: number }>({ party: 1, spendThisTurn: 1 })
    .toArray();

  const fundsByParty = new Map<string, number>();
  for (const c of campaigns) {
    const spend = typeof c.spendThisTurn === "number" ? c.spendThisTurn : 0;
    if (spend <= 0) continue;
    fundsByParty.set(c.party, (fundsByParty.get(c.party) ?? 0) + spend);
  }
  return fundsByParty;
}
