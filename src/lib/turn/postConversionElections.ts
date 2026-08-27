import type { Db } from "mongodb";
import { updateCountryState } from "@/lib/countryState";
import { getCountryStateCollection } from "@/lib/db/collections/countryState";
import { triggerSnapElection } from "@/lib/turn/snapElection";

/**
 * Fire the election a system conversion promised.
 *
 * `bootstrapNewSystem` has written `countryState.pendingPostConversionElection`
 * since Phase 6, and its own header and the field's type annotation both state
 * that "the election engine consumer reads + clears this on the first
 * post-conversion election". Nothing ever did. The result was that a Stage 4
 * regime collapse, and a voluntary constitutional convention alike, flipped the
 * government type and scheduled an election that never happened. This is that
 * missing consumer.
 *
 * A TURN STEP, not a hook inside the conversion. A conversion can run from a
 * request path, and an election spawned from a request would spawn again on a
 * retry. Reaching it from a stamp on a document instead means it fires once, on
 * a tick, however the conversion was reached.
 *
 * Must run AFTER election resolution and the perpetual ensurers, so it reads
 * settled seat state, exactly as `processByElectionWatcher` requires.
 */
export async function processPostConversionElections(
  db: Db,
  currentTurn: number,
  now: Date
): Promise<{ fired: number }> {
  // Filtered in the QUERY rather than in a loop guard: once a world has a
  // history of conversions, every country carries a spent marker field, and
  // reading them all back every tick to discard most of them is work the index
  // can do instead.
  const rows = await getCountryStateCollection(db)
    .find({ "pendingPostConversionElection.atTurn": { $lte: currentTurn } })
    .toArray();

  let fired = 0;
  for (const row of rows) {
    const countryId = row._id;
    try {
      await triggerSnapElection(db, countryId, now, {
        reason: "regime-change",
        bypassLimits: true,
      });
      fired++;
    } catch (err) {
      // Logged and swallowed, per country. A country with no governmentFormation
      // row cannot snap at all, and one country's missing document must neither
      // stop the others nor fail the turn.
      console.error(`[postConversion] ${countryId} snap failed:`, err);
    }
    // Cleared whether or not the snap succeeded, and OUTSIDE the try for that
    // reason. A marker left in place would retry every turn forever, and a
    // country that cannot snap today will not start being able to tomorrow.
    await updateCountryState(db, countryId, { pendingPostConversionElection: undefined });
  }

  return { fired };
}
