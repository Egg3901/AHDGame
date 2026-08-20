/**
 * Commit one play: validate it, pay for it, queue it.
 *
 * Everything lives here rather than in the route so it can be tested without
 * HTTP, and so the ordering below — which is the whole correctness story — is
 * in one readable place.
 *
 * ORDER MATTERS. Validate fully, then take the guarded debit, then charge the
 * treasury, then insert. Both debits are guarded `$inc`s whose filter restates
 * the precondition, so a double-submit races on the WRITE rather than on the
 * read and the loser spends nothing.
 *
 * NOT ATOMIC ACROSS THE THREE WRITES, and deliberately so — this repo does not
 * use Mongo transactions anywhere on a player action path (see
 * `launchGovernmentProspect`, which takes the same claim → charge → write
 * shape). What that costs, stated plainly rather than left to be discovered:
 *
 *   - the guarded claim fails      → nothing is spent, nothing is queued. Safe,
 *                                    and this is the only failure a concurrent
 *                                    double-submit can actually produce.
 *   - `spendFromTreasury` throws   → seat AP and capital are gone, no play. The
 *                                    player is out a turn's budget.
 *   - `insertOne` throws           → AP, capital and treasury are gone, no play.
 *
 * The last two need a database outage mid-request, and the order is chosen so
 * money always moves BEFORE the effect exists: a player can be over-charged and
 * refunded, but can never get a free play. If this repo ever gains transactions,
 * wrap from the claim to the insert and delete this note.
 */
import { ObjectId, type Db } from "mongodb";
import type { Character } from "@/lib/db/types";
import type { SettlementPlayDoc } from "@/lib/db/types/settlementPlay";
import { getPlay } from "@/lib/constants/settlementCrisis";
import type { CountryId } from "@/lib/constants/countries";
import type { FederalBudget } from "@/lib/db/types/budget";
import { getSettlementCrisesCollection, getSettlementPlaysCollection } from "@/lib/db/collections";
import { spendFromTreasury } from "@/lib/budget/treasurySpend";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { loadSettlementActorContext } from "../actorContext";
import { resolvePersonalFunds, seatFundsLocal } from "../playCost";

export interface CommitPlayInput {
  characterId: ObjectId;
  actor: "seat" | "personal";
  playId: string;
  /** Required for a personal play; ignored on a seat play. */
  direction?: 1 | -1;
}

export type CommitPlayResult =
  | { ok: true; playId: string; appliedDirection: 1 | -1 }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string): CommitPlayResult => ({ ok: false, status, error });

export async function commitSettlementPlay(
  db: Db,
  input: CommitPlayInput
): Promise<CommitPlayResult> {
  const play = getPlay(input.playId);
  if (!play) return fail(400, "No such play.");

  const ctx = await loadSettlementActorContext(db, input.characterId);
  if (!ctx) return fail(404, "The German Question is not running.");
  if (!ctx.crisisId) return fail(404, "No settlement crisis is open.");

  const crises = await getSettlementCrisesCollection(db);
  const crisisId = new ObjectId(ctx.crisisId);
  const crisis = await crises.findOne({ _id: crisisId });
  if (!crisis) return fail(404, "No settlement crisis is open.");
  if (crisis.status !== "open") {
    return fail(409, "The crisis is frozen while the war it started is fought.");
  }

  const turn = await getCurrentTurn(db);
  const now = new Date();
  // Annotated, not inferred: this is every field of the row EXCEPT the ones the
  // two branches below differ on, so the compiler checks completeness here and
  // neither `insertOne` needs a cast that could assert a missing field away.
  const base: Omit<SettlementPlayDoc, "_id" | "actor" | "seatId" | "countryId" | "direction"> = {
    crisisId,
    characterId: input.characterId,
    playId: play.id,
    targetInstitutionId: play.target,
    class: play.class,
    costs: { funds: play.fundsCost, capital: play.capitalCost, actions: play.actionCost },
    basePoints: play.magnitude,
    appliedPoints: null,
    heatAdded: play.addsHeat ? 1 : 0,
    turn,
    resolvedTurn: null,
    createdAt: now,
  };

  const plays = await getSettlementPlaysCollection(db);

  if (input.actor === "seat") {
    if (play.seat === null) return fail(403, "That play is not a delegation's to make.");
    const seat = ctx.seat;
    if (!seat) return fail(403, "You hold no delegation on this question.");
    if (play.seat !== seat.id) return fail(403, "That play belongs to another delegation.");
    if (seat.direction === null) {
      return fail(409, "Your country belongs to neither bloc, so it has no side to push for.");
    }

    const fundsLocal = seatFundsLocal(play);
    if (fundsLocal > 0) {
      // Pre-check: `spendFromTreasury` borrows silently rather than refusing.
      const budget = await db
        .collection<FederalBudget>("federalBudget")
        .findOne(
          { countryId: seat.id as FederalBudget["countryId"] },
          { projection: { treasuryBalance: 1 } }
        );
      if ((budget?.treasuryBalance ?? 0) < fundsLocal) {
        return fail(402, "The national treasury cannot cover this play.");
      }
    }

    // Guarded debit. The filter restates the budget the context reported, so a
    // second submit racing this one matches nothing and pays nothing.
    const claimed = await crises.updateOne(
      {
        _id: crisisId,
        status: "open",
        seats: {
          $elemMatch: {
            id: seat.id,
            capital: { $gte: play.capitalCost },
            actionsUsedTurn: { $lte: seat.budget.actionsPerTurn - play.actionCost },
          },
        },
      },
      {
        $inc: {
          "seats.$.capital": -play.capitalCost,
          "seats.$.actionsUsedTurn": play.actionCost,
        },
        $set: { updatedAt: now },
      }
    );
    if (claimed.matchedCount !== 1) {
      return fail(409, "Your delegation's budget changed before the play landed. Try again.");
    }

    // AFTER the claim: the claim is what makes this single-writer, so charging
    // first would let a losing race still spend the treasury.
    if (fundsLocal > 0) {
      await spendFromTreasury(db, seat.id as CountryId, fundsLocal);
    }

    await plays.insertOne({
      ...base,
      _id: new ObjectId(),
      actor: "seat",
      seatId: seat.id,
      countryId: seat.id as CountryId,
      direction: seat.direction,
    });
    return { ok: true, playId: play.id, appliedDirection: seat.direction };
  }

  // ── personal ──────────────────────────────────────────────────────────────
  if (play.seat !== null) return fail(403, "That play is a delegation's, not yours to make.");
  if (input.direction !== 1 && input.direction !== -1) {
    return fail(400, "Choose which way to push.");
  }

  const character = await db
    .collection<Character>("characters")
    .findOne({ _id: input.characterId });
  if (!character) return fail(404, "Character not found.");

  const funds = await resolvePersonalFunds(db, character, play);

  const debited = await db.collection<Character>("characters").updateOne(
    {
      _id: input.characterId,
      actions: { $gte: play.actionCost },
      [funds.field]: { $gte: funds.local },
    },
    {
      $inc: { actions: -play.actionCost, [funds.field]: -funds.local },
      $set: { updatedAt: now },
    }
  );
  if (debited.matchedCount !== 1) {
    return fail(409, "Your actions or funds changed before the play landed. Try again.");
  }

  await plays.insertOne({
    ...base,
    _id: new ObjectId(),
    actor: "personal",
    seatId: null,
    countryId: null,
    direction: input.direction,
    // Record what was ACTUALLY charged, not the anchor figure — the audit trail
    // has to match the balance the player watched go down.
    costs: { ...base.costs, funds: funds.local },
  });
  return { ok: true, playId: play.id, appliedDirection: input.direction };
}
