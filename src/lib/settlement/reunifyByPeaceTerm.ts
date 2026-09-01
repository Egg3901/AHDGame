/**
 * Settle the German Question from a peace TERM rather than from a war's outcome.
 *
 * The ordinary road is `settleFrozenCrisisFromConflict`: the war is fought, somebody
 * wins it, and a turn sweep reads the result. This is the other one. A `reunification`
 * term is the challenger asking for that outcome directly, while the fighting is
 * still going on, so the settlement has to happen when the term is APPLIED rather
 * than on a later tick.
 *
 * Synchronous for the same reason the dictate route applies its term synchronously:
 * the offer has been accepted, and a player who has just agreed to reunification
 * should not load a map that still shows two Germanies until the next hour turns.
 *
 * ALWAYS THE CHALLENGER'S OUTCOME, whoever proposed the term. Either founding
 * belligerent may put a reunification on the table — from the incumbent it is a
 * capitulation — but what it settles does not change with the sender, so the outcome
 * is hardcoded here rather than passed in and a future caller cannot quietly use this
 * to hand the question to the incumbent instead. That outcome is not a settlement
 * anybody imposes: it is what happens when nothing changes.
 */
import type { Db } from "mongodb";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";
import { getSettlementCrisesCollection } from "@/lib/db/collections";
import { actuateSettlementOutcome } from "@/lib/settlement/actuate";
import { emitSettlementWire } from "@/lib/settlement/emitWire";

export interface ReunifyByTermResult {
  actuated: boolean;
  /**
   * True when the crisis was CLAIMED and its consequences then did not complete.
   *
   * Distinct from "nothing to do". Actuation claims the reopen cooldown as its first
   * act, so nothing retries a half-done settlement and no sweep will notice it: this
   * flag and the log below are the only trace it leaves.
   */
  deferred: boolean;
  error?: string;
}

/** Nothing was claimed, so nothing is half-done. */
const NOT_ACTUATED: ReunifyByTermResult = { actuated: false, deferred: false };

export async function reunifyByPeaceTerm(
  db: Db,
  conflictId: string,
  currentTurn: number
): Promise<ReunifyByTermResult> {
  const crises = await getSettlementCrisesCollection(db);
  const crisis = await crises.findOne({
    conflictId,
    status: "frozen",
    // Scoped exactly as `loadTermSettlement` scopes the check that authorised this.
    // A validator and an applier that disagree about which crisis they mean is how a
    // term gets approved against one document and applied to another.
    kind: "settlement.germanQuestion",
  } as Parameters<typeof crises.findOne>[0]);
  // No question on this war is not an error here. `validatePeaceTerm` already refused
  // the term for exactly this case; reaching it means the crisis moved between the
  // check and the apply, and the right answer is to change nothing.
  if (!crisis) return NOT_ACTUATED;

  // Guarded on `frozen`, the same claim `settleFrozenCrisisFromConflict` makes: the
  // actuation this unlocks is not replayable, and a turn sweep can be running against
  // this document at the same moment as the request that got here.
  const claimed = await crises.updateOne(
    { _id: crisis._id, status: "frozen" },
    {
      $set: {
        status: "resolved",
        outcome: "challenger",
        resolvedTurn: currentTurn,
        updatedAt: new Date(),
      },
    }
  );
  if (claimed.matchedCount !== 1) return NOT_ACTUATED;

  // The CLAIMED document, not the one read above. `actuateSettlementOutcome` refuses
  // anything that is not already `resolved` with an outcome, so passing the frozen
  // copy would claim the crisis and then quietly actuate nothing.
  const resolved: SettlementCrisisDoc = {
    ...crisis,
    status: "resolved",
    outcome: "challenger",
    resolvedTurn: currentTurn,
  };
  const result = await actuateSettlementOutcome(db, resolved, currentTurn);

  // FILE THE DISPATCH HERE, because no tick will file it for us. `settlementPhase`
  // announces a settlement when IT actuates one, and its sweep is keyed on
  // `cooldownUntilTurn: null` — which `actuateSettlementOutcome` claims as its first
  // act. Actuating from a request therefore hides the crisis from the only code that
  // would have announced it, and Germany reunifies in silence.
  //
  // Safe from a request path, unlike most posts: `emitSettlementWire` claims the
  // `postedWireEvents` stamp with a `$ne` guard BEFORE sending, so a retried request
  // finds the stamp and sends nothing. That is the property `acceptPeace` lacks and
  // why it stamps the war instead of posting.
  //
  // Gated on `actuated`, for the reason the phase gives at its own call site: a
  // reunification that was claimed and then failed halfway is the one lie the wire
  // could tell. The RESOLVED document, because the copy branches on the outcome.
  if (result.actuated) {
    await emitSettlementWire(db, resolved, currentTurn, { events: ["settled"] });
    return { actuated: true, deferred: false };
  }

  // LOUD, because nothing else will say it. On the turn road a failed actuation at
  // least shows up in the phase's result; this runs inside a request whose caller
  // discards the outcome, and the cooldown claim means no later tick retries it.
  console.error(
    `[Settlement] reunification by peace term did not complete for ${conflictId}:`,
    result.error ?? "no reason given"
  );
  return { actuated: false, deferred: true, error: result.error };
}
