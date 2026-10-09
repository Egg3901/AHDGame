import type { Db } from "mongodb";
import { runInflationRecalc } from "@/lib/turn/inflationRecalc";
import { HALF_TICK_FRACTION } from "./stepFraction";

/**
 * :30 half step for inflation. See stepFraction.ts for the contract and
 * stepBase.ts for how the turn completes the hour.
 *
 * Runs the turn's own inflation model on the state last settled with
 * stepFraction = HALF_TICK_FRACTION, so each country's rate moves part way
 * along the adjustment path the turn takes (two halves against one target
 * compose to one full step) and its household price index compounds half a
 * turn. Each budget is stamped, with its start values, in the same update.
 * Savings pressure and the history series stay hourly.
 */
export async function runInflationHalfStep(
  db: Db,
  turn: number,
  _now: Date
): Promise<Record<string, unknown>> {
  const started = Date.now();
  const stats = await runInflationRecalc(db, turn, { stepFraction: HALF_TICK_FRACTION });
  return {
    countries: stats.updated,
    alreadyStepped: stats.alreadyStepped,
    ms: Date.now() - started,
  };
}
