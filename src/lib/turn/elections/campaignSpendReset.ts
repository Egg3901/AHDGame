/**
 * Per-turn spend-stock rollover sweep for the swing-flow engine's money
 * driver.
 *
 * Each campaign accumulates `spendThisTurn` via $inc as upgrades fire
 * (`campaignCommands.ts`) and maintenance ticks (`campaignTurn.ts`). After
 * every general-election tally in a turn-tick has read its campaigns'
 * spend (via `fundsByParty.ts`, which sums carried stock plus the live
 * accumulator), this sweep folds the accumulator into the decaying
 * `spendStock` and clears it so the NEXT turn's interval starts fresh.
 *
 * Ticket #1261: the sweep used to simply wipe the accumulator, so the
 * driver forgot everything every turn. Now the stock carries recent spend
 * forward with `SPEND_STOCK_RETENTION` fade — idle turns decay gradually
 * instead of cliffing to zero, while hoarded treasuries still score zero
 * (the stock only grows through actual spend). Stock below
 * `SPEND_STOCK_DUST_CUTOFF` is dropped so idle rows go quiet instead of
 * dribbling fractions forever.
 *
 * Runs as a turn-phase scheduled after `voteAccumulation` in
 * `turnPhaseRegistry.ts`. Phase and function names are kept (they are
 * referenced by turn logs and the phase registry) even though the sweep
 * now rolls over rather than purely resetting.
 */

import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Campaign } from "@/lib/db/types";
import {
  SPEND_STOCK_DUST_CUTOFF,
  SPEND_STOCK_RETENTION,
} from "@/lib/electionEngine/electionFormulaFactors";

export interface CampaignSpendResetResult {
  campaignsReset: number;
}

/**
 * Sweep that folds `spendThisTurn` into `spendStock` (with retention
 * fade) on every campaign row carrying either, then clears the
 * accumulator. Idempotent — once rolled, the row matches the filter
 * only via a live stock ≥ dust cutoff, and a fully idle row drops its
 * stock and goes quiet.
 */
export async function processCampaignSpendReset(
  injectedDb?: Db
): Promise<CampaignSpendResetResult> {
  const db = injectedDb ?? (await getDb());

  const result = await db.collection<Campaign>("campaigns").updateMany(
    {
      $or: [{ spendThisTurn: { $gt: 0 } }, { spendStock: { $gte: SPEND_STOCK_DUST_CUTOFF } }],
    },
    [
      {
        $set: {
          spendStock: {
            $let: {
              vars: {
                rolled: {
                  $add: [
                    {
                      $multiply: [{ $ifNull: ["$spendStock", 0] }, SPEND_STOCK_RETENTION],
                    },
                    { $ifNull: ["$spendThisTurn", 0] },
                  ],
                },
              },
              in: {
                $cond: [{ $lt: ["$$rolled", SPEND_STOCK_DUST_CUTOFF] }, "$$REMOVE", "$$rolled"],
              },
            },
          },
        },
      },
      { $unset: "spendThisTurn" },
    ]
  );

  return { campaignsReset: result.modifiedCount ?? 0 };
}
