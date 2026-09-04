/**
 * Deciding which settled wars go on the wire this tick, and stamping them so each
 * goes exactly once.
 *
 * A TURN STEP, and it has to be. Both roads to a settlement are REQUEST paths: a
 * dictated term is imposed from a route, and a negotiated one is accepted from a
 * route. The settlement crisis emitter is explicit about why that rules out posting
 * from either of them: it would put a network call on a player's request path, and
 * it would fire again on a retry. So both roads stamp `settlement` on the conflict
 * and post nothing, and this sweeps the stamp.
 *
 * THE STAMP, NOT THE STATE, is what makes a one-off post one-off. A settled war
 * stays settled for ever, so a sweeper keyed on the status alone would repost it on
 * every tick until the end of the world. Keying on `postedWireEvents` turns "this is
 * true now" into "this became true".
 *
 * Every write is guarded on the stamp being absent, so two overlapping turn runs
 * cannot both post: the loser's `$ne` filter matches nothing and it returns without
 * sending. The stamp is written BEFORE the post goes out, which means a crash
 * between the two loses a dispatch rather than repeating one, which is the right way
 * round for something that cannot be unsent.
 */
import type { Db, Filter } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { createSystemNewsPost } from "@/lib/news";
import { sendNewsEvent } from "@/lib/discordWebhooks";
import { buildSettledDispatch, type WarDispatch, type WarWireEvent } from "./warWire";
import { loadPartyChoices, partyDisplayName } from "./peaceOffer";

/**
 * The stamp this sweep writes. Typed rather than inlined so the query filter and the
 * `$addToSet` below cannot drift apart on a typo, which would repost a war for ever.
 */
const SETTLED: WarWireEvent = "settled";

/** How many settled wars one tick will report. A tick never settles many. */
const MAX_PER_TICK = 20;

/**
 * Publish one dispatch to the in-game feed and to the Discord news channel.
 *
 * Never throws: a turn must not fail because Discord did. Each side is caught
 * separately so an outage on one still lets the other through.
 */
export async function postWarWire(dispatch: WarDispatch): Promise<void> {
  try {
    await createSystemNewsPost(dispatch.body, "general", { title: dispatch.title });
  } catch (err) {
    console.error("[WarWire] news post failed:", err);
  }
  try {
    await sendNewsEvent(dispatch.embed);
  } catch (err) {
    console.error("[WarWire] world news webhook failed:", err);
  }
}

export async function emitWarWire(db: Db, _currentTurn: number): Promise<{ posts: number }> {
  const settled = await getConflictsCollection(db)
    .find({
      status: "resolved",
      // Only wars that ended since this feature existed. A world's whole archive of
      // previously resolved wars carries no `endTurn`-adjacent stamp and must not be
      // reported now as though it had just happened.
      settlement: { $exists: true },
      postedWireEvents: { $ne: SETTLED },
    } as Filter<ConflictDoc>)
    .limit(MAX_PER_TICK)
    .toArray();

  let posts = 0;
  for (const conflict of settled as ConflictDoc[]) {
    // Claim the stamp FIRST, and conditionally. Two turn runners reading the same
    // document would both see it unstamped, so a read-then-write would post twice.
    const claimed = await getConflictsCollection(db).updateOne(
      { _id: conflict._id, postedWireEvents: { $ne: SETTLED } } as Filter<ConflictDoc>,
      { $addToSet: { postedWireEvents: SETTLED } }
    );
    if (claimed.modifiedCount !== 1) continue;

    // The term stores a party ID; the dispatch needs a name. Resolved HERE
    // rather than in the builder, which is pure by design so the copy stays
    // testable without a database. Only loaded for the one term that names a
    // party, so an indemnity does not pay for a query it never reads.
    const settlement = conflict.settlement;
    const namedParty =
      settlement &&
      settlement.term.kind === "regime_change" &&
      settlement.term.rulingPartyId != null
        ? settlement.term.rulingPartyId
        : null;
    const rulingPartyName =
      settlement && namedParty != null
        ? partyDisplayName(await loadPartyChoices(db, settlement.target), namedParty)
        : null;

    await postWarWire(buildSettledDispatch(conflict, rulingPartyName));
    posts++;
  }

  return { posts };
}
