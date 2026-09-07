/**
 * Per-party spend aggregator for the swing-flow engine's money driver.
 *
 * Ticket #1261 follow-up: the driver used to read raw "active pacing"
 * (spend-this-turn only), which forgot everything every turn — an idler
 * read exactly like a side that never spent, and any-spend vs ~nothing
 * saturated the log-ratio bar over pocket change. It now reads a decaying
 * stock of recent spend: the carried `spendStock` plus the live
 * `spendThisTurn` accumulator (this turn's spend counts at full weight at
 * tally time; the reset sweep folds it into the stock afterwards).
 * Hoarded treasuries still score zero — the stock only grows through
 * actual spend — and the stock dies with the campaign row on resolution,
 * so nothing carries across elections.
 *
 * Missing / undefined values degrade to 0 — backward-compat with old rows.
 */

import type { Db, ObjectId } from "mongodb";
import type { Campaign } from "@/lib/db/types";

/**
 * Aggregate `Campaign.spendStock` + `Campaign.spendThisTurn` by party for
 * a single election.
 *
 * Sums every campaign in the race by their party, returning a Map keyed
 * by party ID with the per-party spend total. Parties with zero spend
 * are omitted (driver treats them as 0 via Map.get(p) ?? 0).
 *
 * Returns an empty Map when:
 *   - no campaigns exist for the election (early-cycle NPP races, etc.)
 *   - every campaign has no spend recorded
 *
 * Either case is fine — the money driver returns 0 when fundsJ and
 * fundsI are both 0.
 */
/**
 * The same aggregate for many elections in one read, keyed by election id
 * string. A turn's vote accumulation used to issue this per election.
 */
export async function loadFundsByPartyForElections(
  electionIds: ObjectId[],
  db: Db
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (electionIds.length === 0) return out;
  const campaigns = await db
    .collection<Campaign>("campaigns")
    .find({ electionId: { $in: electionIds } })
    .project<{ electionId: ObjectId; party: string; spendStock?: number; spendThisTurn?: number }>({
      electionId: 1,
      party: 1,
      spendStock: 1,
      spendThisTurn: 1,
    })
    .toArray();
  for (const c of campaigns) {
    const stock = typeof c.spendStock === "number" ? c.spendStock : 0;
    const fresh = typeof c.spendThisTurn === "number" ? c.spendThisTurn : 0;
    const spend = stock + fresh;
    if (spend <= 0) continue;
    const key = c.electionId.toString();
    const byParty = out.get(key) ?? new Map<string, number>();
    byParty.set(c.party, (byParty.get(c.party) ?? 0) + spend);
    out.set(key, byParty);
  }
  return out;
}

export async function getFundsByPartyForElection(
  electionId: ObjectId,
  db: Db
): Promise<Map<string, number>> {
  const campaigns = await db
    .collection<Campaign>("campaigns")
    .find({ electionId })
    .project<{ party: string; spendStock?: number; spendThisTurn?: number }>({
      party: 1,
      spendStock: 1,
      spendThisTurn: 1,
    })
    .toArray();

  const fundsByParty = new Map<string, number>();
  for (const c of campaigns) {
    const stock = typeof c.spendStock === "number" ? c.spendStock : 0;
    const fresh = typeof c.spendThisTurn === "number" ? c.spendThisTurn : 0;
    const spend = stock + fresh;
    if (spend <= 0) continue;
    fundsByParty.set(c.party, (fundsByParty.get(c.party) ?? 0) + spend);
  }
  return fundsByParty;
}
