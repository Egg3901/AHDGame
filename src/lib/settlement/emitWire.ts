/**
 * Deciding what goes on the wire this tick, and stamping it so it goes once.
 *
 * Split from `wire.ts` because that module is pure builders and this one is the
 * db-touching half — which keeps the copy testable without a database and the
 * stamping testable without asserting on prose.
 *
 * THE STAMP, NOT THE STATE, is what makes a one-off post one-off. A crisis can
 * sit at DEFCON 1 for twenty turns and the tick sees `armed` on every one of
 * them; a frozen crisis stays frozen for as long as the war runs. Keying on
 * `postedWireEvents` is what turns "this is true now" into "this became true".
 *
 * Every write is guarded on the stamp being absent, so two overlapping turn
 * runs cannot both post: the loser's `$ne` filter matches nothing and it
 * returns without sending. The stamp is written BEFORE the post goes out, which
 * means a crash between the two loses a dispatch rather than repeating one —
 * the right way round for something that cannot be unsent.
 */
import type { Db, Filter } from "mongodb";
import { getSettlementCrisesCollection } from "@/lib/db/collections";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";
import {
  briefingIsDue,
  buildBriefing,
  buildEventDispatch,
  countPublicVoices,
  postSettlementWire,
  type SettlementWireEvent,
} from "./wire";

export interface EmitWireOptions {
  /** One-off moments to consider. Each is skipped if already stamped. */
  events?: readonly SettlementWireEvent[];
  /** Also file the periodic sentiment briefing, if it is due. */
  briefing?: boolean;
}

export interface EmitWireResult {
  posts: number;
  /** Which dispatches went out, for the turn log and for tests. */
  kinds: string[];
}

export async function emitSettlementWire(
  db: Db,
  crisis: SettlementCrisisDoc,
  currentTurn: number,
  options: EmitWireOptions
): Promise<EmitWireResult> {
  const crises = await getSettlementCrisesCollection(db);
  const kinds: string[] = [];

  for (const event of options.events ?? []) {
    // Claim the stamp first. `$ne` rather than a read-then-write: two turn runs
    // reading the same document would both see it unstamped.
    const claimed = await crises.updateOne(
      { _id: crisis._id, postedWireEvents: { $ne: event } } as Filter<SettlementCrisisDoc>,
      { $addToSet: { postedWireEvents: event }, $set: { updatedAt: new Date() } }
    );
    if (claimed.matchedCount !== 1) continue;
    await postSettlementWire(buildEventDispatch(event, crisis));
    kinds.push(event);
  }

  if (options.briefing && briefingIsDue(crisis, currentTurn)) {
    const since = crisis.lastBriefing?.turn ?? crisis.openedTurn;
    const claimed = await crises.updateOne(
      {
        _id: crisis._id,
        // Restates the cadence: if another runner filed this turn's briefing,
        // its stamp is already at or past this turn and this matches nothing.
        $or: [{ "lastBriefing.turn": { $lt: currentTurn } }, { lastBriefing: null }],
      } as Filter<SettlementCrisisDoc>,
      {
        $set: {
          lastBriefing: { turn: currentTurn, position: crisis.position },
          updatedAt: new Date(),
        },
      }
    );
    if (claimed.matchedCount === 1) {
      const publicVoices = await countPublicVoices(db, crisis, since, currentTurn);
      await postSettlementWire(buildBriefing({ crisis, currentTurn, publicVoices }));
      kinds.push("briefing");
    }
  }

  return { posts: kinds.length, kinds };
}
