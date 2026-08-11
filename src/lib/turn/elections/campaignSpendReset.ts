/**
 * Per-turn `spendThisTurn` reset sweep for the swing-flow engine's money
 * driver.
 *
 * Each campaign accumulates `spendThisTurn` via $inc as upgrades fire
 * (`campaignCommands.ts`) and maintenance ticks (`campaignTurn.ts`). The
 * swing-flow engine's money driver reads this value to detect active
 * pacing vs idle treasury. After every general-election tally in a
 * turn-tick has read its campaigns' spend, the field should reset so
 * the NEXT turn's interval starts fresh — otherwise player upgrades and
 * maintenance accumulate forever and the driver loses its temporal
 * signal.
 *
 * Runs as a turn-phase scheduled after `voteAccumulation` in
 * `turnPhaseRegistry.ts`. See
 * `2026-05-22-swing-flow-driver-activation.md` §A2 for design.
 */

import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Campaign } from "@/lib/db/types";

export interface CampaignSpendResetResult {
  campaignsReset: number;
}

/**
 * Sweep that `$unset`s `spendThisTurn` on every campaign row that
 * currently has a non-zero value. Idempotent — once cleared, the row is
 * skipped on subsequent runs until the next spend write re-populates it.
 *
 * Why `$unset` rather than `$set: 0`: the field is documented as
 * "undefined / missing on pre-Phase-A2 rows; degrades to 0 in the
 * money-driver aggregation." Keeping the "absent = 0" invariant means
 * older campaign rows (before this lands) and freshly-reset rows look
 * identical to the read side — no schema migration needed.
 */
export async function processCampaignSpendReset(
  injectedDb?: Db
): Promise<CampaignSpendResetResult> {
  const db = injectedDb ?? (await getDb());

  const result = await db
    .collection<Campaign>("campaigns")
    .updateMany({ spendThisTurn: { $gt: 0 } }, { $unset: { spendThisTurn: "" } });

  return { campaignsReset: result.modifiedCount ?? 0 };
}
